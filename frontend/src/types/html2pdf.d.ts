declare module 'html2pdf.js' {
  interface Html2PdfOptions {
    margin?: number | number[];
    filename?: string;
    image?: { type?: string; quality?: number };
    html2canvas?: {
      scale?: number;
      useCORS?: boolean;
      logging?: boolean;
      scrollX?: number;
      scrollY?: number;
      backgroundColor?: string | null;
      windowWidth?: number;
    };
    jsPDF?: { unit?: string; format?: string | number[]; orientation?: 'portrait' | 'landscape' };
    pagebreak?: { mode?: string[] | string; before?: string[]; after?: string[]; avoid?: string[] };
  }

  interface Html2PdfInstance {
    from(element: HTMLElement | string): Html2PdfInstance;
    set(options: Html2PdfOptions): Html2PdfInstance;
    toPdf(): Html2PdfInstance;
    get(key: string): Promise<any>;
    then(callback: (val?: any) => any): Html2PdfInstance;
    save(filename?: string): Promise<void>;
    outputPdf(type?: string): Promise<any>;
    prop?: any;
    opt?: any;
  }

  function html2pdf(): Html2PdfInstance;
  function html2pdf(element: HTMLElement | string, options?: Html2PdfOptions): Html2PdfInstance;

  export default html2pdf;
}
