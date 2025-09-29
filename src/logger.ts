import { scraperUI, type LogLevel } from "@src/ui";

const COLOR_MAP: Record<LogLevel, string> = {
	info: "\x1b[36m",
	warn: "\x1b[33m",
	error: "\x1b[31m",
	success: "\x1b[32m",
};

const RESET = "\x1b[0m";

function output(level: LogLevel, message: string): void {
	if (scraperUI.isActive()) {
		scraperUI.addLog(level, message);
		return;
	}

	const prefix = `[${level.toUpperCase().padEnd(7, " ")}]`;
	const color = COLOR_MAP[level];
	process.stdout.write(`${color}${prefix}${RESET} ${message}\n`);
}

export const logger = {
	info(message: string): void {
		output("info", message);
	},
	warn(message: string): void {
		output("warn", message);
	},
	error(message: string): void {
		output("error", message);
	},
	success(message: string): void {
		output("success", message);
	},
};

export default logger;
