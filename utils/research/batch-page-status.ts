import { readBatchNavigationToken } from './batch-queue';
import type { BatchPageStatusRequest } from './messages';
import type { PageStatus } from './types';

export function createDocumentBatchPageStatusRequest(
  navigationHash: string,
): (status: PageStatus) => BatchPageStatusRequest {
  const navigationToken = readBatchNavigationToken(navigationHash);
  return (status) => ({
    target: 'background',
    type: 'FIN_REPORT_CLIPPER_BATCH_PAGE_STATUS',
    ...(navigationToken ? { navigationToken } : {}),
    status,
  });
}
