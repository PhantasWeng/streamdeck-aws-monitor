import streamDeck from '@elgato/streamdeck';
// 使用 @napi-rs/canvas 的 node-canvas 相容層（跨平台靜態連結 binary，見 scripts/copy-canvas.mjs）
import { type Canvas, type CanvasRenderingContext2D, createCanvas, type Image, loadImage } from '@napi-rs/canvas/node-canvas.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildChartSegments,
	CHART_GAP_MS,
	type ChartBox,
	hasChartData,
	latestValue,
} from './ec2-chart';
import {
	availableMetrics,
	chartMetricKey,
	classifyInstanceState,
	type Ec2DisplayMode,
	type Ec2Footer,
	type Ec2Metrics,
	type Ec2Series,
	metricLabel,
} from './ec2-metrics';

// Iconify line-md 靜態圖示路徑定義
type IconPathDef = { d: string; opacity?: number };

const ICON_CHECK: IconPathDef[] = [{ d: 'M5 11l6 6l10-10' }];
const ICON_ARROW_DOWN: IconPathDef[] = [{ d: 'M12 5v12' }, { d: 'M7 13l5 5l5-5' }];
const ICON_CLOSE: IconPathDef[] = [{ d: 'M6 6l12 12' }, { d: 'M18 6l-12 12' }];
const ICON_PAUSE: IconPathDef[] = [{ d: 'M9 6v12' }, { d: 'M15 6v12' }];

const CANVAS_SIZE = 144;
const INIT_STATUS_LABEL = 'NOT SET';
const TITLE_Y = 16;

// 指標列排版：在標題與 footer 之間的縱向區帶內依列數均分
const ROWS_TOP = 44;
const ROWS_BOTTOM = 112;
const METRIC_LABEL_X = 6;
const METRIC_BAR_X = 46; // 與 label 留小間隔
const METRIC_BAR_RIGHT = 98;
const METRIC_PERCENT_X = 104; // 緊接進度條右側（左對齊，固定小間隔，10%/100% 一致）
const METRIC_BAR_HEIGHT = 12;

// 線圖模式版面：名稱獨佔第一行（置中，與 all 模式一致），其下為滿版線圖，
// footer 右側改放「模式標示＋目前數值」——線圖本身就是時間軸，不會有 loading
// 狀態要表達，故該位置的狀態圖示讓給數值
const CHART_META_RIGHT = 138;
const CHART_META_GAP = 6; // 模式標示與數值之間的間隔
// 線圖上緣與 all 模式的指標列（ROWS_TOP）對齊
const CHART_BOX: ChartBox = { left: 4, top: 44, width: 136, height: 68 };
const CHART_LINE_WIDTH = 2.5;
const CHART_TIP_RADIUS = 3;
const NO_CHART_DATA_LABEL = 'NO DATA';

// Footer（時間 + 狀態圖示）
const FOOTER_TEXT_Y = 124;

// 外框（與 CodePipeline 一致）
const DEFAULT_BORDER_WIDTH = 6;
const BORDER_RADIUS = 22;
const CONTENT_INSET = 12;

const iconImageCache = new Map<string, Promise<Image>>();
const actionKeyIconPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../imgs/actions/ec2/key@2x.png');
// 這個 promise 在 module 載入時就啟動，但第一個 await 要等到按鈕出現（willAppear）才發生。
// 若圖檔讀不到而沒有就地 catch，rejection 會在這段空窗期裸奔並終止整個外掛程序（見 async-guard.ts）。
const actionKeyIconPromise: Promise<Image | null> = loadImage(actionKeyIconPath).catch((error) => {
	streamDeck.logger.error('Failed to load EC2 action key icon', error);
	return null;
});

const formatTime = (): string => {
	const now = new Date();
	return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

const createButtonCanvas = (): { canvas: Canvas; ctx: CanvasRenderingContext2D } => {
	const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
	const ctx = canvas.getContext('2d');
	ctx.textBaseline = 'top';
	return { canvas, ctx };
};

const TITLE_DOT_RADIUS = 5;
const TITLE_DOT_GAP = 8; // 狀態點與名稱之間的間隔
const TITLE_MAX_TEXT_WIDTH = 106; // 名稱最大寬度（扣掉狀態點與間隔後仍留邊距）

/**
 * 繪製「狀態點 + 名稱」整組並水平置中：
 * 狀態點在名稱前方，量測文字寬度後把整組置中。
 * all 與線圖兩種模式共用同一套標題排版。
 */
const drawTitleWithState = (ctx: CanvasRenderingContext2D, title: string, state: string): void => {
	ctx.font = 'bold 24px sans-serif';
	ctx.textAlign = 'left';
	const textWidth = Math.min(ctx.measureText(title).width, TITLE_MAX_TEXT_WIDTH);
	const dotDiameter = TITLE_DOT_RADIUS * 2;
	const groupWidth = dotDiameter + TITLE_DOT_GAP + textWidth;
	const groupLeft = (CANVAS_SIZE - groupWidth) / 2;

	// 狀態點（垂直對齊文字中心）
	ctx.fillStyle = getStateColor(state);
	ctx.beginPath();
	ctx.arc(groupLeft + TITLE_DOT_RADIUS, TITLE_Y + 9, TITLE_DOT_RADIUS, 0, Math.PI * 2);
	ctx.fill();

	// 名稱
	ctx.fillStyle = 'white';
	ctx.fillText(title, groupLeft + dotDiameter + TITLE_DOT_GAP, TITLE_Y, TITLE_MAX_TEXT_WIDTH);
};

const createIconSvg = (paths: IconPathDef[], color: string): Buffer => {
	const pathElements = paths
		.map(({ d, opacity }) => `<path d="${d}"${opacity !== undefined ? ` opacity="${opacity}"` : ''}/>`)
		.join('');
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
			`<g fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">` +
			`${pathElements}</g></svg>`
	);
};

const getIconImage = async (paths: IconPathDef[], color: string): Promise<Image> => {
	const key = `${color}|${paths.map(({ d, opacity }) => `${d}:${opacity ?? ''}`).join('|')}`;
	const cached = iconImageCache.get(key);
	if (cached) {
		return cached;
	}
	const imagePromise = loadImage(createIconSvg(paths, color));
	// 失敗的 promise 不留在快取裡毒化後續每一幀；同時這個 catch 也確保
	// 即使呼叫端這次不 await（例如已被 dispose）也不會有裸奔的 rejection
	imagePromise.catch(() => iconImageCache.delete(key));
	iconImageCache.set(key, imagePromise);
	return imagePromise;
};

const drawIcon = async (
	ctx: CanvasRenderingContext2D,
	paths: IconPathDef[],
	color: string,
	x: number,
	y: number,
	size: number
): Promise<void> => {
	const img = await getIconImage(paths, color);
	ctx.drawImage(img, x, y, size, size);
};

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
	ctx.save();
	ctx.translate(x + size / 2, y + size / 2 + yOffset);
	ctx.globalAlpha = alpha;
	ctx.drawImage(img, -size / 2, -size / 2, size, size);
	ctx.restore();
};

const fillRoundedRect = (
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number
): void => {
	const r = Math.min(radius, width / 2, height / 2);
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + width, y, x + width, y + height, r);
	ctx.arcTo(x + width, y + height, x, y + height, r);
	ctx.arcTo(x, y + height, x, y, r);
	ctx.arcTo(x, y, x + width, y, r);
	ctx.closePath();
	ctx.fill();
};

const drawBorder = (ctx: CanvasRenderingContext2D, color: string, borderWidth: number): void => {
	const offset = borderWidth / 2;
	const w = CANVAS_SIZE - borderWidth;
	const h = CANVAS_SIZE - borderWidth;
	const r = BORDER_RADIUS;
	ctx.strokeStyle = color;
	ctx.lineWidth = borderWidth;
	ctx.beginPath();
	ctx.moveTo(offset + r, offset);
	ctx.arcTo(offset + w, offset, offset + w, offset + h, r);
	ctx.arcTo(offset + w, offset + h, offset, offset + h, r);
	ctx.arcTo(offset, offset + h, offset, offset, r);
	ctx.arcTo(offset, offset, offset + w, offset, r);
	ctx.closePath();
	ctx.stroke();
};

/**
 * 依 instance 狀態分類取得代表色（狀態燈與大字狀態共用）
 */
const getStateColor = (state: string): string => {
	switch (classifyInstanceState(state)) {
		case 'running':
			return '#4ade80';
		case 'transitioning':
			return '#60a5fa';
		case 'stopped':
			return '#9ca3af';
		case 'terminated':
			return '#f87171';
		default:
			return '#9ca3af';
	}
};

/**
 * 依使用率門檻取得指標條顏色：<70 綠、<90 琥珀、>=90 紅
 */
const getUsageColor = (pct: number): string => {
	if (pct >= 90) {
		return '#f87171';
	}
	if (pct >= 70) {
		return '#fbbf24';
	}
	return '#4ade80';
};

/**
 * 把 #rrggbb 轉成帶透明度的 rgba()，供線圖的漸層填充使用
 */
const hexToRgba = (hex: string, alpha: number): string => {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * 線圖模式的 footer：時間靠左（與 all 模式相同），右側原本的狀態圖示位置
 * 改放「模式標示（CPU/MEM/DSK）＋目前數值」。
 * 數值先靠右定位，模式標示再貼著它的左側，數值長短變化時標示不會浮動。
 */
const drawChartFooter = (
	ctx: CanvasRenderingContext2D,
	timeText: string,
	modeLabel: string,
	value?: number
): void => {
	ctx.fillStyle = 'white';
	ctx.font = '18px sans-serif';
	ctx.textAlign = 'left';
	ctx.fillText(timeText, 8, FOOTER_TEXT_Y);

	const valueText = value !== undefined ? `${value}%` : '--';
	ctx.textAlign = 'right';
	ctx.font = 'bold 18px sans-serif';
	// 數值與折線同色，一眼看出健康度
	ctx.fillStyle = value !== undefined ? getUsageColor(value) : '#9ca3af';
	const valueWidth = ctx.measureText(valueText).width;
	ctx.fillText(valueText, CHART_META_RIGHT, FOOTER_TEXT_Y);

	ctx.font = 'bold 14px sans-serif';
	ctx.fillStyle = '#9ca3af';
	// 字級較小，下推 2px 與數值視覺對齊
	ctx.fillText(modeLabel, CHART_META_RIGHT - valueWidth - CHART_META_GAP, FOOTER_TEXT_Y + 2);
};

/**
 * 繪製心電圖線圖：底線基準＋面積漸層＋折線＋末端亮點。
 * 資料缺口由 buildChartSegments 斷成多段，不會連成一條假的連續線。
 */
const drawSparkline = (ctx: CanvasRenderingContext2D, series: Ec2Series): void => {
	const box = CHART_BOX;
	const segments = buildChartSegments(series, box, CHART_GAP_MS);
	const color = getUsageColor(latestValue(series) ?? 0);
	const bottom = box.top + box.height;

	// 基準底線，讓折線有依託（不畫 70/90 閾值線，144px 上太雜）
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(box.left, bottom);
	ctx.lineTo(box.left + box.width, bottom);
	ctx.stroke();

	const gradient = ctx.createLinearGradient(0, box.top, 0, bottom);
	gradient.addColorStop(0, hexToRgba(color, 0.38));
	gradient.addColorStop(1, hexToRgba(color, 0));

	for (const segment of segments) {
		// 單點的段沒有線可畫，點一個小圓表示該時刻有資料
		if (segment.length === 1) {
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.arc(segment[0].x, segment[0].y, CHART_LINE_WIDTH / 2, 0, Math.PI * 2);
			ctx.fill();
			continue;
		}

		// 面積填充
		ctx.fillStyle = gradient;
		ctx.beginPath();
		ctx.moveTo(segment[0].x, bottom);
		for (const point of segment) {
			ctx.lineTo(point.x, point.y);
		}
		ctx.lineTo(segment[segment.length - 1].x, bottom);
		ctx.closePath();
		ctx.fill();

		// 折線本身
		ctx.strokeStyle = color;
		ctx.lineWidth = CHART_LINE_WIDTH;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		ctx.beginPath();
		segment.forEach((point, index) => {
			if (index === 0) {
				ctx.moveTo(point.x, point.y);
			} else {
				ctx.lineTo(point.x, point.y);
			}
		});
		ctx.stroke();
	}

	// 末端亮點標出「現在」
	const tip = segments.at(-1)?.at(-1);
	if (tip) {
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(tip.x, tip.y, CHART_TIP_RADIUS, 0, Math.PI * 2);
		ctx.fill();
	}
};

/**
 * status check 為 impaired 時的線圖：整條壓在 0 並轉為灰色。
 * 這時實例雖然還是 running，指標已不可信，刻意不呈現任何實際數值
 *（footer 的數字同步改為 --），一眼就能和正常波形區分。
 */
const drawImpairedChart = (ctx: CanvasRenderingContext2D): void => {
	const box = CHART_BOX;
	const bottom = box.top + box.height;
	ctx.strokeStyle = '#9ca3af';
	ctx.lineWidth = CHART_LINE_WIDTH;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(box.left, bottom);
	ctx.lineTo(box.left + box.width, bottom);
	ctx.stroke();
};

/**
 * 線圖模式下 running 卻沒有資料（未裝 CloudWatch Agent、或剛開機還沒生出資料點）
 */
const drawNoChartData = (ctx: CanvasRenderingContext2D): void => {
	ctx.fillStyle = '#9ca3af';
	ctx.font = 'bold 20px sans-serif';
	ctx.textAlign = 'center';
	// 置於線圖區縱向中央
	ctx.fillText(NO_CHART_DATA_LABEL, 72, CHART_BOX.top + CHART_BOX.height / 2 - 10, 132);
};

/**
 * 繪製指標列：label（左）＋使用率條（中）＋百分比（右）。
 * 依列數在縱向區帶內均分置中。
 */
const drawMetricRows = (ctx: CanvasRenderingContext2D, metrics: Ec2Metrics): void => {
	const rows = availableMetrics(metrics);
	if (rows.length === 0) {
		return;
	}

	const slot = (ROWS_BOTTOM - ROWS_TOP) / rows.length;
	const barWidth = METRIC_BAR_RIGHT - METRIC_BAR_X;

	rows.forEach((row, index) => {
		const cy = ROWS_TOP + slot * (index + 0.5);
		const textY = cy - 9;

		ctx.fillStyle = 'white';
		ctx.font = 'bold 17px sans-serif';
		ctx.textAlign = 'left';
		ctx.fillText(row.label, METRIC_LABEL_X, textY);

		// 底軌
		const barTop = cy - METRIC_BAR_HEIGHT / 2;
		ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
		fillRoundedRect(ctx, METRIC_BAR_X, barTop, barWidth, METRIC_BAR_HEIGHT, 4);
		// 使用率填色
		const fillWidth = Math.max(0, Math.min(1, row.value / 100)) * barWidth;
		if (fillWidth > 0) {
			ctx.fillStyle = getUsageColor(row.value);
			fillRoundedRect(ctx, METRIC_BAR_X, barTop, Math.max(fillWidth, 4), METRIC_BAR_HEIGHT, 4);
		}

		ctx.fillStyle = 'white';
		ctx.font = '17px sans-serif';
		ctx.textAlign = 'left';
		ctx.fillText(`${row.value}%`, METRIC_PERCENT_X, textY);
	});
};

/**
 * 無指標時（stopped/pending/terminated…）在中央顯示大字狀態，
 * 過渡狀態以 rotationDeg 為相位做透明度脈動。
 */
const drawStateLabel = (ctx: CanvasRenderingContext2D, state: string, rotationDeg: number): void => {
	const cls = classifyInstanceState(state);
	ctx.save();
	if (cls === 'transitioning') {
		const wave = Math.sin((rotationDeg * Math.PI) / 180);
		ctx.globalAlpha = 0.5 + 0.5 * ((wave + 1) / 2);
	}
	ctx.fillStyle = getStateColor(state);
	ctx.font = 'bold 26px sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText(state.toUpperCase(), 72, 66, 132);
	ctx.restore();
};

const drawFooter = async (
	ctx: CanvasRenderingContext2D,
	footer: Ec2Footer,
	timeText: string,
	phaseDeg: number
): Promise<void> => {
	ctx.fillStyle = 'white';
	ctx.font = '18px sans-serif';
	ctx.textAlign = 'left';
	ctx.fillText(timeText, 8, FOOTER_TEXT_Y);
	switch (footer) {
		case 'healthy':
			await drawIcon(ctx, ICON_CHECK, '#4ade80', 120, FOOTER_TEXT_Y, 16);
			break;
		case 'impaired':
			await drawIcon(ctx, ICON_CLOSE, '#f87171', 118, FOOTER_TEXT_Y - 1, 18);
			break;
		case 'terminated':
			await drawIcon(ctx, ICON_CLOSE, '#f87171', 118, FOOTER_TEXT_Y - 1, 18);
			break;
		case 'stopped':
			await drawIcon(ctx, ICON_PAUSE, '#9ca3af', 120, FOOTER_TEXT_Y, 16);
			break;
		case 'transitioning':
			await drawBreathingIcon(ctx, ICON_ARROW_DOWN, 'white', 120, FOOTER_TEXT_Y, 16, phaseDeg);
			break;
		default:
			await drawIcon(ctx, ICON_ARROW_DOWN, '#9ca3af', 120, FOOTER_TEXT_Y, 16);
			break;
	}
};

export type Ec2FrameSpec = {
	title: string;
	state: string;
	metrics: Ec2Metrics;
	footer: Ec2Footer;
	rotationDeg: number;
	borderColor?: string | null;
	borderWidth?: number; // 可選：外框線寬（px），未給用預設值
	displayMode?: Ec2DisplayMode; // 未給視為 all（現況的多指標橫條）
	series?: Ec2Series; // 線圖模式的時間序列
};

// 幀快取：與 CodePipeline 相同策略，唯一隨時間變動的是 HH:mm，
// 以「分鐘 + 完整參數」為 key 快取整張 data URL。
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

const metricsKey = (metrics: Ec2Metrics): string => `${metrics.cpu ?? ''},${metrics.mem ?? ''},${metrics.disk ?? ''}`;

// 序列的每個值都會影響畫面，故整串進快取 key；視窗右緣也要納入
// （同一批資料在不同時間點的 x 位置不同）。每分鐘整個快取會被清空，不會無限長大。
const seriesKey = (series?: Ec2Series): string =>
	series ? `${series.windowEndMs}:${series.points.map(point => point.v).join(',')}` : '';

/**
 * 繪製 EC2 狀態畫面，回傳 base64 data URL（有快取）。
 * all 模式：running 且有指標 → 指標列；其餘 → 大字狀態。
 * 線圖模式：running → 線圖（無資料時 NO DATA）；非 running → 與 all 模式相同的大字狀態。
 */
export const renderFrame = async (spec: Ec2FrameSpec): Promise<string> => {
	const chartKey = chartMetricKey(spec.displayMode ?? 'all');
	const isRunning = classifyInstanceState(spec.state) === 'running';
	const borderWidth = spec.borderWidth ?? DEFAULT_BORDER_WIDTH;
	const key = `${spec.title}|${spec.state}|${metricsKey(spec.metrics)}|${spec.footer}|${spec.rotationDeg}|${spec.borderColor ?? ''}|${borderWidth}|${spec.displayMode ?? 'all'}|${seriesKey(spec.series)}`;
	const cached = getCachedFrame(key);
	if (cached) {
		return cached;
	}

	const { canvas, ctx } = createButtonCanvas();
	const scale = (CANVAS_SIZE - CONTENT_INSET * 2) / CANVAS_SIZE;
	ctx.save();
	ctx.translate(CONTENT_INSET, CONTENT_INSET);
	ctx.scale(scale, scale);

	if (chartKey && isRunning) {
		// 線圖模式：數值一律取自序列末端，與線圖末端必然一致
		const impaired = spec.footer === 'impaired';
		drawTitleWithState(ctx, spec.title, spec.state);
		if (impaired) {
			drawImpairedChart(ctx);
		} else if (hasChartData(spec.series) && spec.series) {
			drawSparkline(ctx, spec.series);
		} else {
			drawNoChartData(ctx);
		}
		// impaired 時不給值，footer 會顯示灰色的 --
		drawChartFooter(ctx, frameCacheTime, metricLabel(chartKey), impaired ? undefined : latestValue(spec.series));
	} else {
		drawTitleWithState(ctx, spec.title, spec.state);
		if (availableMetrics(spec.metrics).length > 0) {
			drawMetricRows(ctx, spec.metrics);
		} else {
			drawStateLabel(ctx, spec.state, spec.rotationDeg);
		}
		await drawFooter(ctx, spec.footer, frameCacheTime, spec.rotationDeg);
	}

	ctx.restore();

	if (spec.borderColor) {
		drawBorder(ctx, spec.borderColor, borderWidth);
	}

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
	const scale = (CANVAS_SIZE - CONTENT_INSET * 2) / CANVAS_SIZE;
	ctx.save();
	ctx.translate(CONTENT_INSET, CONTENT_INSET);
	ctx.scale(scale, scale);

	// 載入失敗時 actionKeyIconPromise 已記錄錯誤並回傳 null，此處僅略過 logo 繼續繪製其餘內容
	const iconImg = await actionKeyIconPromise;
	if (iconImg) {
		const logoSize = 60;
		ctx.drawImage(iconImg, (CANVAS_SIZE - logoSize) / 2, 6, logoSize, logoSize);
	}

	ctx.fillStyle = 'white';
	ctx.font = 'bold 22px sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText(title, 72, 78, 134);

	ctx.fillStyle = '#f59e0b';
	ctx.font = 'bold 20px sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText(INIT_STATUS_LABEL, 72, 116, 132);

	ctx.restore();

	const dataUrl = canvas.toDataURL();
	frameCache.set(key, dataUrl);
	return dataUrl;
};
