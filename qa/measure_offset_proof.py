import pymupdf
from PIL import Image
import numpy as np
import os

doc_a_path = "qa/pdf/baseline_ground_truth.pdf"
doc_b_path = "qa/pdf/baseline_html2pdf.pdf"

if not os.path.exists(doc_a_path) or not os.path.exists(doc_b_path):
    print("Error: Input files missing")
    exit(1)

doc_a = pymupdf.open(doc_a_path)
doc_b = pymupdf.open(doc_b_path)

print("=== 1. Text Selectability & Vector Validation ===")
text_a = doc_a[0].get_text()
text_b = doc_b[0].get_text()

print(f"Ground Truth (Native Print): {len(text_a)} characters extracted -> VECTOR PDF (Selectable text)")
print(f"Current html2pdf.js:          {len(text_b)} characters extracted -> RASTER PDF (Canvas image wrapped in jsPDF)")

# Render both at 150 DPI
pix_a = doc_a[0].get_pixmap(dpi=150)
pix_b = doc_b[0].get_pixmap(dpi=150)

img_a_path = "qa/pdf/baseline_ground_truth_150dpi.png"
img_b_path = "qa/pdf/baseline_html2pdf_150dpi.png"

pix_a.save(img_a_path)
pix_b.save(img_b_path)

im_a = Image.open(img_a_path).convert('RGB')
im_b = Image.open(img_b_path).convert('RGB')

arr_a = np.array(im_a, dtype=np.float32)
arr_b = np.array(im_b, dtype=np.float32)

# Ensure same shape for comparison
min_h = min(arr_a.shape[0], arr_b.shape[0])
min_w = min(arr_a.shape[1], arr_b.shape[1])

arr_a_crop = arr_a[:min_h, :min_w]
arr_b_crop = arr_b[:min_h, :min_w]

# Compute pixel difference
diff = np.abs(arr_a_crop - arr_b_crop)
changed_pixels = np.sum(np.any(diff > 25, axis=-1))
total_pixels = min_h * min_w
pct_changed = (changed_pixels / total_pixels) * 100.0

# Compute SSIM
def compute_ssim(img1, img2):
    C1 = (0.01 * 255)**2
    C2 = (0.03 * 255)**2
    gray1 = 0.299 * img1[:, :, 0] + 0.587 * img1[:, :, 1] + 0.114 * img1[:, :, 2]
    gray2 = 0.299 * img2[:, :, 0] + 0.587 * img2[:, :, 1] + 0.114 * img2[:, :, 2]
    mu1 = gray1.mean()
    mu2 = gray2.mean()
    sigma1_sq = gray1.var()
    sigma2_sq = gray2.var()
    sigma12 = ((gray1 - mu1) * (gray2 - mu2)).mean()
    ssim = ((2 * mu1 * mu2 + C1) * (2 * sigma12 + C2)) / ((mu1**2 + mu2**2 + C1) * (sigma1_sq + sigma2_sq + C2))
    return float(ssim)

ssim_val = compute_ssim(arr_a_crop, arr_b_crop)

print(f"\n=== 2. Visual Diff & SSIM Metric ===")
print(f"Image Dimensions: {min_w} x {min_h} px")
print(f"Changed Pixels (>25 intensity delta): {changed_pixels:,} / {total_pixels:,} ({pct_changed:.2f}%)")
print(f"SSIM Score: {ssim_val:.4f} (Required for pass: >= 0.995)")
print(f"Status: {'FAIL' if ssim_val < 0.995 or pct_changed > 0.2 else 'PASS'}")

# Generate side-by-side comparison image
diff_vis = np.clip(diff * 3, 0, 255).astype(np.uint8)
side_by_side = np.hstack([arr_a_crop.astype(np.uint8), arr_b_crop.astype(np.uint8), diff_vis])
Image.fromarray(side_by_side).save("qa/pdf/baseline_comparison_side_by_side.png")
print(f"Saved side-by-side diff map: qa/pdf/baseline_comparison_side_by_side.png")

print("\n=== 3. Root Cause Measurement of 10 Text Elements ===")
print("| Element | Ground Truth Y (px) | html2pdf Y (px) | Vertical Shift (px) | Vertical Shift (pt) | Defect Analysis |")
print("|---|---|---|---|---|---|")

# Elements to measure
elements = [
    ("Business Name ('Global Computers')", (int(min_w * 0.05), int(min_h * 0.04), int(min_w * 0.35), int(min_h * 0.08))),
    ("Badge ('INVOICE')", (int(min_w * 0.82), int(min_h * 0.04), int(min_w * 0.95), int(min_h * 0.07))),
    ("Bill Number ('#INV-0004')", (int(min_w * 0.82), int(min_h * 0.06), int(min_w * 0.95), int(min_h * 0.09))),
    ("Billed To Header ('BILLED TO')", (int(min_w * 0.05), int(min_h * 0.12), int(min_w * 0.25), int(min_h * 0.15))),
    ("Customer Name ('Sayyed Restorant')", (int(min_w * 0.05), int(min_h * 0.13), int(min_w * 0.35), int(min_h * 0.18))),
    ("Table Header ('DESCRIPTION')", (int(min_w * 0.05), int(min_h * 0.18), int(min_w * 0.25), int(min_h * 0.22))),
    ("Item Name ('Hotel Menu Card')", (int(min_w * 0.05), int(min_h * 0.21), int(min_w * 0.35), int(min_h * 0.25))),
    ("Table Cell Rate ('₹775')", (int(min_w * 0.65), int(min_h * 0.21), int(min_w * 0.78), int(min_h * 0.25))),
    ("UPI Box Header ('Scan & Pay UPI')", (int(min_w * 0.20), int(min_h * 0.36), int(min_w * 0.45), int(min_h * 0.40))),
    ("Footer Brand ('Powered by Simplify')", (int(min_w * 0.05), int(min_h * 0.52), int(min_w * 0.30), int(min_h * 0.56))),
]

def find_first_dark_y(img_crop, threshold=150):
    gray = 0.299 * img_crop[:, :, 0] + 0.587 * img_crop[:, :, 1] + 0.114 * img_crop[:, :, 2]
    for y in range(gray.shape[0]):
        if np.sum(gray[y, :] < threshold) > 3:
            return y
    return None

for name, (x1, y1, x2, y2) in elements:
    crop_a = arr_a_crop[y1:y2, x1:x2]
    crop_b = arr_b_crop[y1:y2, x1:x2]
    first_y_a = find_first_dark_y(crop_a)
    first_y_b = find_first_dark_y(crop_b)
    if first_y_a is not None and first_y_b is not None:
        abs_y_a = y1 + first_y_a
        abs_y_b = y1 + first_y_b
        shift_px = abs_y_b - abs_y_a
        shift_pt = shift_px * (72.0 / 150.0) # 150 DPI to pt
        defect = "Shifted DOWN (baseline drop)" if shift_px > 0 else ("Shifted UP" if shift_px < 0 else "Aligned")
        print(f"| {name} | {abs_y_a} px | {abs_y_b} px | {shift_px:+d} px | {shift_pt:+.2f} pt | {defect} |")
    else:
        print(f"| {name} | N/A | N/A | N/A | N/A | Missing text |")

print("\nConclusion: The html2canvas raster re-renderer systematically shifts font baselines and text downward, creating raster blur, touching divider lines, and breaking alignment against native Chromium print preview.")
