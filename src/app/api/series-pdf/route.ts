import { NextResponse } from 'next/server';
import { jsPDF } from 'jspdf';

export const runtime = 'nodejs';

function sanitizeForPdf(s: string): string {
  return s
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/\u2248/g, '~')
    .replace(/\u2260/g, '!=')
    .replace(/\u00b2/g, '2')
    .replace(/\u00b3/g, '3')
    .replace(/\u201e/g, '"')
    .replace(/\u201c/g, '"')
    .replace(/\u201d/g, '"')
    .replace(/\u201a/g, "'")
    .replace(/\u2018/g, "'")
    .replace(/\u2019/g, "'")
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00ab/g, '"')
    .replace(/\u00bb/g, '"')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u00d7/g, 'x')
    .replace(/\u00f7/g, '/')
    .replace(/\u2022/g, '-')
    .replace(/[^\x00-\x7F\u00c0-\u00ff]/g, '');
}

function stripMarkdown(s: string): string {
  return sanitizeForPdf(
    s
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/<!--.*?-->/g, '')
      .trim()
  );
}

interface PDFElement {
  type: 'h1' | 'h2' | 'h3' | 'p' | 'ul' | 'ol' | 'table' | 'pagebreak';
  content: string;
  items?: string[];
  tableData?: { headers: string[]; rows: string[][] };
}

function parseMarkdownToPDFElements(md: string): PDFElement[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const elements: PDFElement[] = [];
  let currentList: string[] = [];
  let currentListType: 'ul' | 'ol' | null = null;

  const flushList = () => {
    if (currentList.length > 0 && currentListType) {
      elements.push({ type: currentListType, content: '', items: [...currentList] });
      currentList = [];
      currentListType = null;
    }
  };

  const isTableSep = (s: string) =>
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(s);

  const splitTableRow = (s: string) => {
    let row = s.trim();
    if (row.startsWith('|')) row = row.slice(1);
    if (row.endsWith('|')) row = row.slice(0, -1);
    return row.split('|').map((c) => stripMarkdown(c.trim()));
  };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    if (!t) continue;

    // Page breaks
    if (t.includes('<div class="page-break">')) {
      flushList();
      elements.push({ type: 'pagebreak', content: '' });
      continue;
    }

    // Tables
    const looksLikeTableRow = /\|/.test(t);
    const next = i + 1 < lines.length ? lines[i + 1].trim() : '';
    if (looksLikeTableRow && next && isTableSep(next)) {
      flushList();
      const headers = splitTableRow(t);
      i += 2;
      const rows: string[][] = [];
      for (; i < lines.length; i++) {
        const r = lines[i].trim();
        if (!r || !/\|/.test(r)) break;
        rows.push(splitTableRow(r));
      }
      i -= 1;
      elements.push({ type: 'table', content: '', tableData: { headers, rows } });
      continue;
    }

    // Headings
    const h3 = t.match(/^###\s+(.+)$/);
    if (h3) {
      flushList();
      elements.push({ type: 'h3', content: stripMarkdown(h3[1]) });
      continue;
    }

    const h2 = t.match(/^##\s+(.+)$/);
    if (h2) {
      flushList();
      elements.push({ type: 'h2', content: stripMarkdown(h2[1]) });
      continue;
    }

    const h1 = t.match(/^#\s+(.+)$/);
    if (h1) {
      flushList();
      elements.push({ type: 'h1', content: stripMarkdown(h1[1]) });
      continue;
    }

    // Lists
    const ul = t.match(/^[-*]\s+(.+)$/);
    if (ul) {
      if (currentListType !== 'ul') {
        flushList();
        currentListType = 'ul';
      }
      currentList.push(stripMarkdown(ul[1]));
      continue;
    }

    const ol = t.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      if (currentListType !== 'ol') {
        flushList();
        currentListType = 'ol';
      }
      currentList.push(stripMarkdown(ol[1]));
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push({ type: 'p', content: stripMarkdown(t) });
  }

  flushList();
  return elements;
}

function generatePDFFromElements(doc: jsPDF, elements: PDFElement[], title: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const maxWidth = pageWidth - 2 * margin;
  let y = margin;

  const addNewPageIfNeeded = (requiredSpace: number) => {
    if (y + requiredSpace > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const writeText = (text: string, fontSize: number, isBold = false, leftMargin = 0) => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(text, maxWidth - leftMargin);
    const lineHeight = fontSize * 0.5;
    
    addNewPageIfNeeded(lines.length * lineHeight);
    
    lines.forEach((line: string) => {
      doc.text(line, margin + leftMargin, y);
      y += lineHeight;
    });
  };

  // Title
  if (title) {
    writeText(title, 18, true);
    y += 8;
  }

  // Process elements
  for (const el of elements) {
    if (el.type === 'pagebreak') {
      doc.addPage();
      y = margin;
      continue;
    }

    if (el.type === 'h1') {
      y += 6;
      writeText(el.content, 16, true);
      y += 4;
    } else if (el.type === 'h2') {
      y += 5;
      writeText(el.content, 13, true);
      y += 3;
    } else if (el.type === 'h3') {
      y += 4;
      writeText(el.content, 11.5, true);
      y += 2;
    } else if (el.type === 'p') {
      writeText(el.content, 10);
      y += 3;
    } else if (el.type === 'ul' && el.items) {
      for (const item of el.items) {
        writeText('• ' + item, 10, false, 0);
        y += 1;
      }
      y += 3;
    } else if (el.type === 'ol' && el.items) {
      for (let i = 0; i < el.items.length; i++) {
        writeText(`${i + 1}. ${el.items[i]}`, 10, false, 0);
        y += 1;
      }
      y += 3;
    } else if (el.type === 'table' && el.tableData) {
      const { headers, rows } = el.tableData;
      const colWidth = maxWidth / headers.length;
      const cellPadding = 2;
      const minRowHeight = 8;
      
      // Headers
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.1);
      
      let maxHeaderHeight = minRowHeight;
      const headerLines: string[][] = [];
      headers.forEach((h) => {
        const lines = doc.splitTextToSize(h, colWidth - 2 * cellPadding);
        headerLines.push(lines);
        const cellHeight = Math.max(minRowHeight, lines.length * 4 + 4);
        maxHeaderHeight = Math.max(maxHeaderHeight, cellHeight);
      });
      
      addNewPageIfNeeded(maxHeaderHeight + rows.length * minRowHeight + 20);
      
      headers.forEach((h, i) => {
        const x = margin + i * colWidth;
        doc.rect(x, y, colWidth, maxHeaderHeight);
        doc.text(headerLines[i], x + cellPadding, y + 5);
      });
      y += maxHeaderHeight;
      
      // Rows
      doc.setFont('helvetica', 'normal');
      rows.forEach((row) => {
        let maxCellHeight = minRowHeight;
        const cellLines: string[][] = [];
        
        row.forEach((cell) => {
          const lines = doc.splitTextToSize(cell, colWidth - 2 * cellPadding);
          cellLines.push(lines);
          const cellHeight = Math.max(minRowHeight, lines.length * 4 + 4);
          maxCellHeight = Math.max(maxCellHeight, cellHeight);
        });
        
        addNewPageIfNeeded(maxCellHeight);
        
        row.forEach((cell, i) => {
          const x = margin + i * colWidth;
          doc.rect(x, y, colWidth, maxCellHeight);
          doc.text(cellLines[i], x + cellPadding, y + 5);
        });
        y += maxCellHeight;
      });
      
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.2);
      y += 5;
    }
  }
}

export async function POST(req: Request) {
  let payload: { seriesTitle?: unknown; seriesMarkdown?: unknown } | null;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON body.' }, { status: 400 });
  }

  const seriesTitle = typeof payload?.seriesTitle === 'string' ? payload.seriesTitle : '';
  const seriesMarkdown = typeof payload?.seriesMarkdown === 'string' ? payload.seriesMarkdown : '';

  if (!seriesMarkdown.trim()) {
    return NextResponse.json({ error: 'Missing seriesMarkdown.' }, { status: 400 });
  }

  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const elements = parseMarkdownToPDFElements(seriesMarkdown);
    generatePDFFromElements(doc, elements, seriesTitle);

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    const fileName = `series-${new Date().toISOString().split('T')[0]}.pdf`;

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: `PDF generation failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    );
  }
}
