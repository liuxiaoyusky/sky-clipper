import type { CaptureSubmission, PageStatus } from './types';

export interface CaptureRequest {
  target: 'background';
  type: 'FIN_REPORT_CLIPPER_CAPTURE';
  submission: CaptureSubmission;
}

export interface GetPageStatusRequest {
  target: 'content';
  type: 'FIN_REPORT_CLIPPER_GET_PAGE_STATUS';
}

export interface GetPageStatusResponse {
  ok: true;
  status: PageStatus;
}

export interface CreateBlobRequest {
  target: 'offscreen';
  type: 'FIN_REPORT_CLIPPER_CREATE_BLOB';
  requestId: string;
  content: string;
  mime: string;
}

export interface RevokeBlobRequest {
  target: 'offscreen';
  type: 'FIN_REPORT_CLIPPER_REVOKE_BLOB';
  url: string;
}

export function isCaptureRequest(message: unknown): message is CaptureRequest {
  if (!message || typeof message !== 'object') return false;
  const value = message as Partial<CaptureRequest>;
  return (
    value.target === 'background' &&
    value.type === 'FIN_REPORT_CLIPPER_CAPTURE' &&
    Boolean(value.submission?.document)
  );
}

export function isGetPageStatusRequest(message: unknown): message is GetPageStatusRequest {
  if (!message || typeof message !== 'object') return false;
  const value = message as Partial<GetPageStatusRequest>;
  return value.target === 'content' && value.type === 'FIN_REPORT_CLIPPER_GET_PAGE_STATUS';
}
