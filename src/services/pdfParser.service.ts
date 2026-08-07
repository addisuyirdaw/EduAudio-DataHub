/**
 * pdfParser.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * PDF Parsing Service
 * 
 * Handles text extraction and structural parsing from PDF documents.
 * Extracts text per page, identifies structural elements (headings, paragraphs, tables),
 * and maps page boundaries for range-based navigation.
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as FileSystem from 'expo-file-system';
import { v4 as uuidv4 } from 'uuid';
import type { ParsedDocument, ParsedPage, Heading, Table, TextPosition, DocumentMetadata } from '../types/teacher.types';

/**
 * PDF Parser Service
 */
export class PDFParserService {
  /**
   * Parse a PDF document from a local URI
   */
  async parseDocument(uri: string): Promise<ParsedDocument> {
    console.log('[PDFParser] Starting document parsing:', uri);

    try {
      // Read the file
      const fileContent = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // TODO: Integrate react-native-pdf for actual PDF parsing
      // For now, create a mock structure
      const document = await this.createMockDocument(uri);
      
      console.log('[PDFParser] Document parsed successfully');
      return document;
    } catch (error) {
      console.error('[PDFParser] Failed to parse document:', error);
      throw new Error(`PDF parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract text from a specific page
   */
  async extractPageText(document: ParsedDocument, pageNumber: number): Promise<string> {
    if (pageNumber < 1 || pageNumber > document.totalPages) {
      throw new Error(`Invalid page number: ${pageNumber}`);
    }

    const page = document.pages[pageNumber - 1];
    return page?.text || '';
  }

  /**
   * Extract text from a page range
   */
  async extractPageRangeText(document: ParsedDocument, startPage: number, endPage: number): Promise<string> {
    const texts: string[] = [];
    
    for (let page = startPage; page <= endPage; page++) {
      const text = await this.extractPageText(document, page);
      texts.push(text);
    }

    return texts.join('\n\n');
  }

  /**
   * Identify structural elements in text
   * Detects headings, paragraphs, and tables
   */
  private identifyStructuralElements(text: string): {
    headings: Heading[];
    paragraphs: string[];
    tables: Table[];
  } {
    const headings: Heading[] = [];
    const paragraphs: string[] = [];
    const tables: Table[] = [];

    const lines = text.split('\n');
    let position = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines
      if (!trimmedLine) {
        position += line.length + 1;
        continue;
      }

      // Detect headings (all caps, numbered, or short lines followed by blank)
      const isHeading = this.isHeading(trimmedLine, lines, lines.indexOf(line));
      
      if (isHeading) {
        const level = this.determineHeadingLevel(trimmedLine);
        headings.push({
          level,
          text: trimmedLine,
          position,
        });
      } else if (this.isTable(trimmedLine)) {
        // TODO: Implement table detection logic
        // For now, skip table detection
      } else {
        paragraphs.push(trimmedLine);
      }

      position += line.length + 1;
    }

    return { headings, paragraphs, tables };
  }

  /**
   * Determine if a line is a heading
   */
  private isHeading(line: string, allLines: string[], currentIndex: number): boolean {
    // All caps
    if (line === line.toUpperCase() && line.length > 3 && line.length < 100) {
      return true;
    }

    // Numbered heading (e.g., "1. Introduction", "Chapter 3")
    if (/^(\d+\.|Chapter|Section)\s/.test(line)) {
      return true;
    }

    // Short line followed by blank line
    if (line.length < 80 && currentIndex < allLines.length - 1) {
      const nextLine = allLines[currentIndex + 1]?.trim();
      if (!nextLine) {
        return true;
      }
    }

    return false;
  }

  /**
   * Determine heading level (1-6)
   */
  private determineHeadingLevel(line: string): number {
    // Check for numbered hierarchy
    const numberedMatch = line.match(/^(\d+\.)/);
    if (numberedMatch) {
      const depth = (numberedMatch[1].match(/\./g) || []).length + 1;
      return Math.min(depth, 6);
    }

    // Check for chapter/section keywords
    if (/^Chapter\s+\d+/.test(line)) return 1;
    if (/^Section\s+\d+/.test(line)) return 2;

    // Default to level 3 for other headings
    return 3;
  }

  /**
   * Determine if a line represents a table
   */
  private isTable(line: string): boolean {
    // Simple heuristic: lines with multiple tabs or pipes
    const tabCount = (line.match(/\t/g) || []).length;
    const pipeCount = (line.match(/\|/g) || []).length;
    
    return tabCount >= 2 || pipeCount >= 2;
  }

  /**
   * Create a mock document for testing
   * TODO: Replace with actual PDF parsing using react-native-pdf
   */
  private async createMockDocument(uri: string): Promise<ParsedDocument> {
    const totalPages = 10;
    const pages: ParsedPage[] = [];

    for (let i = 1; i <= totalPages; i++) {
      const pageText = this.generateMockPageText(i);
      const structuralElements = this.identifyStructuralElements(pageText);

      pages.push({
        pageNumber: i,
        text: pageText,
        paragraphs: structuralElements.paragraphs,
        headings: structuralElements.headings,
        tables: structuralElements.tables,
        textPosition: this.createTextPositions(pageText),
      });
    }

    return {
      id: uuidv4(),
      title: 'Sample Educational Document',
      uri,
      totalPages,
      pages,
      metadata: {
        author: 'EduAudio',
        subject: 'Educational Content',
        keywords: ['education', 'accessibility', 'audio'],
        creationDate: new Date().toISOString(),
      },
    };
  }

  /**
   * Generate mock page text for testing
   */
  private generateMockPageText(pageNumber: number): string {
    return `Chapter ${Math.ceil(pageNumber / 3)}

Page ${pageNumber}

This is sample educational content for page ${pageNumber}. In a real implementation,
this would be extracted from the actual PDF document using react-native-pdf.

The text would include various structural elements like headings, paragraphs,
and potentially tables or figures. This mock data allows us to test the
parsing and navigation functionality without requiring actual PDF files.

Key concepts on this page:
- Document structure parsing
- Text extraction algorithms
- Accessibility considerations
- Voice command integration

${pageNumber % 3 === 0 ? 'Table 1: Sample Data\n| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| Data 1   | Data 2   | Data 3   |\n' : ''}

End of page ${pageNumber}.`;
  }

  /**
   * Create text position mappings
   */
  private createTextPositions(text: string): TextPosition[] {
    const positions: TextPosition[] = [];
    const words = text.split(/\s+/);
    let currentPosition = 0;

    for (const word of words) {
      if (word) {
        positions.push({
          start: currentPosition,
          end: currentPosition + word.length,
          text: word,
        });
        currentPosition += word.length + 1; // +1 for space
      }
    }

    return positions;
  }

  /**
   * Get page count from document
   */
  async getPageCount(document: ParsedDocument): Promise<number> {
    return document.totalPages;
  }

  /**
   * Search for text within document
   */
  async searchText(document: ParsedDocument, query: string): Promise<Array<{ pageNumber: number; position: number }>> {
    const results: Array<{ pageNumber: number; position: number }> = [];
    const lowerQuery = query.toLowerCase();

    for (const page of document.pages) {
      const lowerText = page.text.toLowerCase();
      let index = 0;
      
      while ((index = lowerText.indexOf(lowerQuery, index)) !== -1) {
        results.push({
          pageNumber: page.pageNumber,
          position: index,
        });
        index += lowerQuery.length;
      }
    }

    return results;
  }
}

// Export singleton instance
export const pdfParserService = new PDFParserService();
