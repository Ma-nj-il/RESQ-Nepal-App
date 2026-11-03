export interface PrivateObjectMetadata {
  readonly objectKey: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly mimeType: string;
}

export interface ObjectStorage {
  createUploadGrant(input: {
    readonly objectKey: string;
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly mimeType: string;
    readonly expiresAt: Date;
  }): Promise<{
    readonly url: string;
    readonly expiresAt: Date;
    readonly requiredHeaders: Readonly<Record<string, string>>;
  }>;
  readMetadata(objectKey: string): Promise<PrivateObjectMetadata | undefined>;
  createDownloadGrant(input: {
    readonly objectKey: string;
    readonly expiresAt: Date;
  }): Promise<{ readonly url: string; readonly expiresAt: Date }>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
