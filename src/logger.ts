import * as fs from 'fs';
import * as path from 'path';
import { nowJst } from './scrapers/base';

// =========================================================
// ロガー
// =========================================================

const LOGS_DIR = path.resolve(__dirname, '..', 'logs');

// logsディレクトリを自動作成
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// 実行開始時刻をファイル名に使用
const startedAt = nowJst()
  .replace('T', '_')
  .replace(/:/g, '-')
  .substring(0, 19);

export const LOG_FILE_PATH = path.join(LOGS_DIR, `run_${startedAt}.log`);

function appendToFile(level: string, message: string): void {
  const line = `${nowJst()} [${level}] ${message}\n`;
  fs.appendFileSync(LOG_FILE_PATH, line, 'utf-8');
}

/** コンソール + ファイル出力 */
export function logInfo(message: string): void {
  console.log(message);
  appendToFile('INFO', message);
}

/** コンソール + ファイル出力 */
export function logWarn(message: string): void {
  console.warn(message);
  appendToFile('WARN', message);
}

/** コンソール + ファイル出力 */
export function logError(message: string): void {
  console.error(message);
  appendToFile('ERROR', message);
}

/** ファイルのみ出力（コンソールには出さない） */
export function logDebug(message: string): void {
  appendToFile('DEBUG', message);
}
