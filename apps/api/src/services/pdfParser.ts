import { extractText, getDocumentProxy } from 'unpdf';

export interface ParsedPdf {
  rawText: string;
  markdownContent: string;
  wordCount: number;
}

export async function parsePdf(buffer: Buffer): Promise<ParsedPdf> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text: extracted } = await extractText(pdf, { mergePages: true });

  // Postgres UTF-8 TEXT rejects 0x00; strip all C0 controls except \t \n \r.
  const text = extracted.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  const rawText = text.replace(/\s+/g, ' ').trim();

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const markdownContent = paragraphs.join('\n\n');

  const wordCount = rawText.split(/\s+/).filter(Boolean).length;

  return { rawText, markdownContent, wordCount };
}
