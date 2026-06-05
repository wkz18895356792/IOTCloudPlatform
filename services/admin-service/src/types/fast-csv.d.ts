declare module 'fast-csv' {
  import { Transform } from 'stream';

  interface CsvFormatterOptions {
    headers?: boolean | string[];
    delimiter?: string;
    quote?: string | boolean;
    escape?: string;
    includeEndRowDelimiter?: boolean;
    rowDelimiter?: string;
    transform?: (row: any) => any;
  }

  interface CsvParserOptions {
    headers?: boolean | string[] | ((headers: string[]) => string[]);
    delimiter?: string;
    quote?: string | null | boolean;
    escape?: string;
    ignoreEmpty?: boolean;
    discardUnmappedColumns?: boolean;
    strictColumnHandling?: boolean;
    renameHeaders?: boolean;
  }

  interface CsvParserStream extends Transform {
    on(event: 'data', listener: (data: any) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
  }

  interface CsvFormatterStream extends Transform {
    write(row: any): boolean;
    end(): this;
    on(event: 'finish', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    pipe<T extends NodeJS.WritableStream>(destination: T): T;
  }

  export function format(options?: CsvFormatterOptions): CsvFormatterStream;
  export function parse(options?: CsvParserOptions): CsvParserStream;

  const csv: {
    format: (options?: CsvFormatterOptions) => CsvFormatterStream;
    parse: (options?: CsvParserOptions) => CsvParserStream;
  };

  export default csv;
}
