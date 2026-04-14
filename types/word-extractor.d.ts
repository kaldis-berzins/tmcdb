declare module 'word-extractor' {
  export default class WordExtractor {
    constructor();
    extract(filePath: string): Promise<{
      getBody(): string;
      getHeaders(): string;
      getFooters(): string;
      // Add other methods/properties as needed based on the library's API
    }>;
  }
}