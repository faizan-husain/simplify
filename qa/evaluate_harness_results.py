import pymupdf
from PIL import Image
import numpy as np
import os
import sys

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

def evaluate_scenario(scenario_name, gt_path, new_path):
    if not os.path.exists(gt_path) or not os.path.exists(new_path):
        return {
            "name": scenario_name,
            "pass": False,
            "reason": f"File missing: {gt_path} or {new_path}"
        }

    doc_gt = pymupdf.open(gt_path)
    doc_new = pymupdf.open(new_path)

    # 1. Page count check
    if len(doc_gt) != len(doc_new):
        return {
            "name": scenario_name,
            "pass": False,
            "reason": f"Page count mismatch: GT={len(doc_gt)}, New={len(doc_new)}"
        }

    # 2. Vector text check
    text_gt = doc_gt[0].get_text().strip()
    text_new = doc_new[0].get_text().strip()
    if len(text_new) == 0:
        return {
            "name": scenario_name,
            "pass": False,
            "reason": "New PDF has 0 selectable text (raster output)"
        }

    # 3. Text blocks bounding box comparison
    blocks_gt = doc_gt[0].get_text("blocks")
    blocks_new = doc_new[0].get_text("blocks")
    max_box_delta = 0.0
    for b_gt, b_new in zip(blocks_gt[:10], blocks_new[:10]):
        # b[:4] are (x0, y0, x1, y1)
        delta_y = abs(b_gt[1] - b_new[1])
        if delta_y > max_box_delta:
            max_box_delta = delta_y

    # 4. Rasterize Page 0 at 150 DPI and compute SSIM + Pixel Diff
    pix_gt = doc_gt[0].get_pixmap(dpi=150)
    pix_new = doc_new[0].get_pixmap(dpi=150)

    img_gt = Image.frombytes("RGB", [pix_gt.width, pix_gt.height], pix_gt.samples)
    img_new = Image.frombytes("RGB", [pix_new.width, pix_new.height], pix_new.samples)

    arr_gt = np.array(img_gt, dtype=np.float32)
    arr_new = np.array(img_new, dtype=np.float32)

    min_h = min(arr_gt.shape[0], arr_new.shape[0])
    min_w = min(arr_gt.shape[1], arr_new.shape[1])

    c_gt = arr_gt[:min_h, :min_w]
    c_new = arr_new[:min_h, :min_w]

    diff = np.abs(c_gt - c_new)
    changed_pixels = np.sum(np.any(diff > 25, axis=-1))
    total_pixels = min_h * min_w
    pct_changed = (changed_pixels / total_pixels) * 100.0

    ssim_score = compute_ssim(c_gt, c_new)

    # Save side-by-side artifact: [Ground Truth | New Pipeline | Diff x 4]
    diff_vis = np.clip(diff * 4, 0, 255).astype(np.uint8)
    side_by_side = np.hstack([c_gt.astype(np.uint8), c_new.astype(np.uint8), diff_vis])
    out_img_path = f"qa/pdf/{scenario_name}_side_by_side.png"
    Image.fromarray(side_by_side).save(out_img_path)

    # Pass rules: SSIM >= 0.995, changed pixels <= 0.2%, max box delta <= 0.5 pt
    is_pass = (ssim_score >= 0.995) and (pct_changed <= 0.20) and (max_box_delta <= 0.50)

    return {
        "name": scenario_name,
        "pass": is_pass,
        "pages": len(doc_new),
        "text_chars": len(text_new),
        "max_box_delta_pt": max_box_delta,
        "pct_changed": pct_changed,
        "ssim": ssim_score,
        "size_kb": round(os.path.getsize(new_path) / 1024, 1),
        "image_path": out_img_path,
    }

def main():
    scenarios = [
        "invoice_standard_a5",
        "invoice_multiline_a5",
        "invoice_large_amounts_a5",
        "receipt_standard_a5",
        "receipt_allocated_a5",
        "customer_statement_a4",
        "vendor_statement_a4",
        "bank_ledger_a4",
        "report_pnl_a4",
        "report_invoices_register_a4",
    ]

    print("==========================================================================================================")
    print("SIMPLIFY ACCEPTANCE HARNESS (§6) — Ground Truth (Print Preview) vs New Chromium Microservice Pipeline")
    print("==========================================================================================================")
    print(f"{'Scenario':<28} | {'Pages':<5} | {'Vector Text':<11} | {'Max BBox Δ':<10} | {'Changed Px':<10} | {'SSIM':<7} | {'Size':<8} | {'Result':<6}")
    print("----------------------------------------------------------------------------------------------------------")

    all_pass = True
    for sc in scenarios:
        gt_path = f"qa/pdf/{sc}_ground_truth.pdf"
        new_path = f"qa/pdf/{sc}_new_pipeline.pdf"
        res = evaluate_scenario(sc, gt_path, new_path)
        if not res.get("pass"):
            all_pass = False

        status = "PASS" if res.get("pass") else "FAIL"
        bbox_str = f"{res.get('max_box_delta_pt', 0.0):.2f} pt"
        changed_str = f"{res.get('pct_changed', 0.0):.2f} %"
        ssim_str = f"{res.get('ssim', 0.0):.4f}"
        size_str = f"{res.get('size_kb', 0.0)} KB"
        pages_str = str(res.get("pages", 0))
        chars_str = f"{res.get('text_chars', 0)} chars"

        print(f"{sc:<28} | {pages_str:<5} | {chars_str:<11} | {bbox_str:<10} | {changed_str:<10} | {ssim_str:<7} | {size_str:<8} | {status:<6}")

    print("==========================================================================================================")
    if all_pass:
        print("ALL SCENARIOS PASSED: 100% visual and text parity with native print preview achieved!")
        sys.exit(0)
    else:
        print("SOME SCENARIOS FAILED.")
        sys.exit(1)

if __name__ == "__main__":
    main()
