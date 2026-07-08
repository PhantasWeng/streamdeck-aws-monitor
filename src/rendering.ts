import streamDeck from '@elgato/streamdeck';
import { createCanvas, type Canvas, type CanvasRenderingContext2D, loadImage, type Image } from 'canvas';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FrameFooter, isLoadingStatus } from './polling';

// Iconify line-md icon path definitions（靜態版，移除動畫）
type IconPathDef = { d: string; opacity?: number };

const ICON_CONFIRM_CIRCLE: IconPathDef[] = [
	{ d: 'M3 12c0-4.97 4.03-9 9-9c4.97 0 9 4.03 9 9c0 4.97-4.03 9-9 9c-4.97 0-9-4.03-9-9Z' },
	{ d: 'M8 12l3 3l5-5' },
];

const ICON_CLOSE_CIRCLE: IconPathDef[] = [
	{ d: 'M3 12c0-4.97 4.03-9 9-9c4.97 0 9 4.03 9 9c0 4.97-4.03 9-9 9c-4.97 0-9-4.03-9-9Z' },
	{ d: 'M12 12l4 4M12 12l-4-4M12 12l-4 4M12 12l4-4' },
];

const ICON_LOADING: IconPathDef[] = [
	{ d: 'M12 3c4.97 0 9 4.03 9 9' },
	{ d: 'M12 3c4.97 0 9 4.03 9 9c0 4.97-4.03 9-9 9c-4.97 0-9-4.03-9-9c0-4.97 4.03-9 9-9Z', opacity: 0.3 },
];

// Footer 用圖示（無圓圈）
const ICON_CHECK: IconPathDef[] = [
	{ d: 'M5 11l6 6l10-10' },
];

const ICON_ARROW_DOWN: IconPathDef[] = [
	{ d: 'M12 5v12' },
	{ d: 'M7 13l5 5l5-5' },
];

// Footer 終止用圖示（line-md--menu-to-close-transition 靜態終態）
const ICON_MENU_TO_CLOSE_TRANSITION: IconPathDef[] = [
	{ d: 'M6 6l12 12' },
	{ d: 'M18 6l-12 12' },
];

const CANVAS_SIZE = 144;
const TITLE_Y = 12;
const STATUS_ICON_Y = 50;

const iconImageCache = new Map<string, Promise<Image>>();
const actionKeyIconPath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../imgs/actions/codepipeline/key@2x.png'
);
const actionKeyIconPromise = loadImage(actionKeyIconPath);

/**
 * 取得目前時間字串（HH:mm）
 */
const formatTime = (): string => {
	const now = new Date();
	return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

/**
 * 建立 Canvas 並初始化基本設定
 */
const createButtonCanvas = (): { canvas: Canvas; ctx: CanvasRenderingContext2D } => {
	const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
	const ctx = canvas.getContext('2d');
	ctx.textBaseline = 'top';
	return { canvas, ctx };
};

/**
 * 繪製標題文字
 */
const drawTitle = (ctx: CanvasRenderingContext2D, title: string): void => {
	ctx.fillStyle = 'white';
	ctx.font = '20px sans-serif bold';
	ctx.textAlign = 'center';
	ctx.fillText(title, 72, TITLE_Y, 134);
};

/**
 * 產生 Iconify line-md 圖示的 SVG Buffer
 */
const createIconSvg = (paths: IconPathDef[], color: string): Buffer => {
	const pathElements = paths.map(({ d, opacity }) =>
		`<path d="${d}"${opacity !== undefined ? ` opacity="${opacity}"` : ''}/>`
	).join('');
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
		`<g fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">` +
		`${pathElements}</g></svg>`
	);
};

/**
 * 取得快取圖示
 */
const getIconImage = async (paths: IconPathDef[], color: string): Promise<Image> => {
	const key = `${color}|${paths.map(({ d, opacity }) => `${d}:${opacity ?? ''}`).join('|')}`;
	const cached = iconImageCache.get(key);
	if (cached) {
		return cached;
	}

	const imagePromise = loadImage(createIconSvg(paths, color));
	iconImageCache.set(key, imagePromise);
	return imagePromise;
};

/**
 * 繪製 Iconify line-md 圖示到 Canvas
 */
const drawIcon = async (ctx: CanvasRenderingContext2D, paths: IconPathDef[], color: string, x: number, y: number, size: number, rotationDeg = 0): Promise<void> => {
	const img = await getIconImage(paths, color);
	if (rotationDeg === 0) {
		ctx.drawImage(img, x, y, size, size);
		return;
	}

	const centerX = x + size / 2;
	const centerY = y + size / 2;
	ctx.save();
	ctx.translate(centerX, centerY);
	ctx.rotate((rotationDeg * Math.PI) / 180);
	ctx.drawImage(img, -size / 2, -size / 2, size, size);
	ctx.restore();
};

/**
 * 繪製呼吸效果圖示（向下位移 + 輕微透明度變化）
 */
const drawBreathingIcon = async (
	ctx: CanvasRenderingContext2D,
	paths: IconPathDef[],
	color: string,
	x: number,
	y: number,
	size: number,
	phaseDeg: number
): Promise<void> => {
	const img = await getIconImage(paths, color);
	const wave = Math.sin((phaseDeg * Math.PI) / 180);
	const downwardWave = (wave + 1) / 2;
	const yOffset = 4 * downwardWave;
	const alpha = 0.78 + 0.22 * (1 - downwardWave);
	const centerX = x + size / 2;
	const centerY = y + size / 2;

	ctx.save();
	ctx.translate(centerX, centerY + yOffset);
	ctx.globalAlpha = alpha;
	ctx.drawImage(img, -size / 2, -size / 2, size, size);
	ctx.restore();
};

/**
 * 取得 pipeline 狀態對應的圖示
 */
const getStatusIcon = (status: string): { icon: IconPathDef[]; color: string } => {
	if (status === 'Succeeded') return { icon: ICON_CONFIRM_CIRCLE, color: '#4ade80' };
	if (status === 'Failed') return { icon: ICON_CLOSE_CIRCLE, color: '#f87171' };
	return { icon: ICON_LOADING, color: '#60a5fa' };
};

/**
 * 繪製狀態圖示
 */
const drawStatusSymbols = async (ctx: CanvasRenderingContext2D, statuses: string[], rotationDeg: number): Promise<void> => {
	const iconSize = 40;
	const gap = 4;
	const totalWidth = statuses.length * iconSize + (statuses.length - 1) * gap;
	let x = (CANVAS_SIZE - totalWidth) / 2;
	const y = STATUS_ICON_Y;

	for (const status of statuses) {
		const { icon, color } = getStatusIcon(status);
		await drawIcon(ctx, icon, color, x, y, iconSize, isLoadingStatus(status) ? rotationDeg : 0);
		x += iconSize + gap;
	}
};

export type FrameSpec = {
	title: string;
	statuses: string[];
	footer: FrameFooter;
	rotationDeg: number;
};

/**
 * 繪製底部時間和狀態指示器
 */
const drawFooter = async (ctx: CanvasRenderingContext2D, footer: FrameFooter, timeText: string, phaseDeg: number): Promise<void> => {
	ctx.fillStyle = 'white';
	ctx.font = '22px sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText(timeText, 52, 110);
	switch (footer) {
		case 'terminated':
			await drawIcon(ctx, ICON_MENU_TO_CLOSE_TRANSITION, '#f87171', 92, 106, 24);
			break;
		case 'succeeded':
			await drawIcon(ctx, ICON_CHECK, '#4ade80', 96, 108, 22);
			break;
		case 'refreshing':
			await drawBreathingIcon(ctx, ICON_ARROW_DOWN, 'white', 96, 108, 22, phaseDeg);
			break;
		default:
			await drawIcon(ctx, ICON_ARROW_DOWN, 'white', 96, 108, 22);
			break;
	}
};

// 幀快取：loading 動畫的旋轉角度是循環的（360 / 24 = 15 幀），
// 畫面中唯一隨時間變動的元素是 HH:mm，因此以「分鐘 + 幀參數」為 key 快取
// 完整 data URL，可省下絕大多數的 canvas 重繪與 PNG 編碼成本
let frameCacheTime = '';
const frameCache = new Map<string, string>();

const getCachedFrame = (key: string): string | undefined => {
	const timeText = formatTime();
	if (timeText !== frameCacheTime) {
		frameCache.clear();
		frameCacheTime = timeText;
	}
	return frameCache.get(key);
};

/**
 * 繪製 pipeline 狀態畫面，回傳 base64 data URL（有快取）
 */
export const renderFrame = async (spec: FrameSpec): Promise<string> => {
	const key = `${spec.title}|${spec.statuses.join(',')}|${spec.footer}|${spec.rotationDeg}`;
	const cached = getCachedFrame(key);
	if (cached) {
		return cached;
	}

	const { canvas, ctx } = createButtonCanvas();
	drawTitle(ctx, spec.title);
	await drawStatusSymbols(ctx, spec.statuses, spec.rotationDeg);
	await drawFooter(ctx, spec.footer, frameCacheTime, spec.rotationDeg);

	const dataUrl = canvas.toDataURL();
	frameCache.set(key, dataUrl);
	return dataUrl;
};

/**
 * 繪製「尚未設定」畫面，回傳 base64 data URL（有快取）
 */
export const renderInitFrame = async (title: string): Promise<string> => {
	const key = `init|${title}`;
	const cached = getCachedFrame(key);
	if (cached) {
		return cached;
	}

	const { canvas, ctx } = createButtonCanvas();
	drawTitle(ctx, title);

	try {
		const iconImg = await actionKeyIconPromise;
		ctx.drawImage(iconImg, 36, 37, 72, 72);
	} catch (error) {
		streamDeck.logger.error('Failed to load action key icon', error);
	}

	// High-contrast status text (no badge background)
	ctx.fillStyle = '#f59e0b';
	ctx.font = '15px sans-serif bold';
	ctx.textAlign = 'center';
	ctx.fillText('NOT CONFIGURED', 72, 110, 132);

	const dataUrl = canvas.toDataURL();
	frameCache.set(key, dataUrl);
	return dataUrl;
};
