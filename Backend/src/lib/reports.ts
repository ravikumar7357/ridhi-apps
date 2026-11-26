/* Amazon reports, the careful way (Reports API 2021-06-30), always through the gateway:
 *
 *   findOrCreateReport  REUSE BEFORE ASKING: if the same report was asked for in the last hour (by this backend or by
 *                       Apps Script: same Amazon app, so we can see both), use that one. createReport is limited to
 *                       about 1 a minute per brand, so this is what lets old and new run side by side without asking
 *                       Amazon twice.
 *   collectReport       not ready → null (come back next run, never wait inside a run); ready → the document's text;
 *                       cancelled or failed → an error. An empty document is the caller's to judge (jobs.keepOldIfEmpty). */

import { gunzipSync } from 'node:zlib';
import type { AmazonGateway, CallCtx } from './gateway.ts';
import type { Brand } from './env.ts';

export interface ReportSpec {
  reportType: string;
  marketplaceIds: string[];
  dataStartTime?: string;
  dataEndTime?: string;
  /** Reports with options (Sales & Traffic granularity, Brand Analytics period) are never reused: Amazon's list
   *  doesn't show the options, so two different reports would look the same. */
  reportOptions?: Record<string, string>;
}

const same = (a?: string, b?: string) => (!a && !b) || (!!a && !!b && Date.parse(a) === Date.parse(b));

export async function findOrCreateReport(gw: AmazonGateway, brand: Brand, spec: ReportSpec, ctx: CallCtx,
  now: () => number = Date.now, reuseWithinMs = 3_600_000): Promise<{ reportId: string; reused: boolean }> {
  if (!spec.reportOptions) {
    const list = await gw.call<{ reports?: any[] }>('reports.getReports', brand, {
      path: '/reports/2021-06-30/reports',
      query: {
        reportTypes: spec.reportType,
        processingStatuses: 'IN_QUEUE,IN_PROGRESS,DONE',
        marketplaceIds: spec.marketplaceIds.join(','),
        createdSince: new Date(now() - reuseWithinMs).toISOString(),
        pageSize: 10,
      },
    }, ctx);
    const hit = (list?.reports || []).find(r => same(r.dataStartTime, spec.dataStartTime) && same(r.dataEndTime, spec.dataEndTime));
    if (hit?.reportId) return { reportId: String(hit.reportId), reused: true };
  }
  const made = await gw.call<{ reportId?: string }>('reports.createReport', brand, {
    method: 'POST', path: '/reports/2021-06-30/reports', body: spec,
  }, ctx);
  if (!made?.reportId) throw new Error(`Amazon gave no report id for ${spec.reportType}`);
  return { reportId: String(made.reportId), reused: false };
}

export async function collectReport(gw: AmazonGateway, brand: Brand, reportId: string, ctx: CallCtx): Promise<string | null> {
  const r = await gw.call<{ processingStatus?: string; reportDocumentId?: string }>('reports.getReport', brand, {
    path: '/reports/2021-06-30/reports/' + encodeURIComponent(reportId),
  }, ctx);
  const st = String(r?.processingStatus || '');
  if (st === 'CANCELLED' || st === 'FATAL') throw new Error(`Amazon ${st === 'FATAL' ? 'failed' : 'cancelled'} report ${reportId}`);
  if (st !== 'DONE' || !r.reportDocumentId) return null;

  const doc = await gw.call<{ url?: string; compressionAlgorithm?: string }>('reports.getReportDocument', brand, {
    path: '/reports/2021-06-30/documents/' + encodeURIComponent(r.reportDocumentId),
  }, ctx);
  if (!doc?.url) throw new Error(`Amazon gave no download address for report ${reportId}`);
  const file = await fetch(doc.url);                         // Amazon's file store, not a rate-limited API call
  if (!file.ok) throw new Error(`Downloading report ${reportId}: ${file.status}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  return (doc.compressionAlgorithm === 'GZIP' ? gunzipSync(bytes) : bytes).toString('utf8');
}
