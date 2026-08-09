/** utif 无官方类型声明，这里给出本项目用到的最小声明 */
declare module 'utif' {
  export interface UTIFIfd {
    width: number;
    height: number;
    data?: Uint8Array;
    [key: string]: unknown;
  }
  export function decode(buffer: ArrayBuffer): UTIFIfd[];
  export function decodeImage(buffer: ArrayBuffer, ifd: UTIFIfd): void;
  export function toRGBA8(ifd: UTIFIfd): Uint8Array;
}

/** File System Access API（Chrome/Edge） */
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

interface FileSystemWritableFileStreamLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>;
}
