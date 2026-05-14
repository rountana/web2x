import { startExtractionWorker } from './extractionWorker.js';
import { startPdfCleanupWorker } from './pdfCleanupWorker.js';

startExtractionWorker();
startPdfCleanupWorker();

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
