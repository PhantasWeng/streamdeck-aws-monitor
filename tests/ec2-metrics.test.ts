import { describe, expect, it } from 'vitest';
import {
	availableMetrics,
	chartMetricKey,
	classifyInstanceState,
	classifyPoll,
	deriveFooter,
	hasMetric,
	isTransitioning,
	metricLabel,
	toDisplayMode,
} from '../src/ec2-metrics';

describe('classifyInstanceState', () => {
	it('過渡狀態', () => {
		expect(classifyInstanceState('pending')).toBe('transitioning');
		expect(classifyInstanceState('stopping')).toBe('transitioning');
		expect(classifyInstanceState('shutting-down')).toBe('transitioning');
	});

	it('穩定狀態', () => {
		expect(classifyInstanceState('running')).toBe('running');
		expect(classifyInstanceState('stopped')).toBe('stopped');
		expect(classifyInstanceState('terminated')).toBe('terminated');
	});

	it('未知狀態', () => {
		expect(classifyInstanceState('weird')).toBe('unknown');
		expect(classifyInstanceState('')).toBe('unknown');
	});
});

describe('classifyPoll', () => {
	it('過渡中與 running 為快輪', () => {
		expect(classifyPoll('pending')).toBe('active');
		expect(classifyPoll('stopping')).toBe('active');
		expect(classifyPoll('running')).toBe('active');
	});

	it('stopped / terminated / unknown 為慢輪', () => {
		expect(classifyPoll('stopped')).toBe('idle');
		expect(classifyPoll('terminated')).toBe('idle');
		expect(classifyPoll('weird')).toBe('idle');
	});
});

describe('isTransitioning', () => {
	it('只有過渡狀態為 true', () => {
		expect(isTransitioning('pending')).toBe(true);
		expect(isTransitioning('running')).toBe(false);
		expect(isTransitioning('stopped')).toBe(false);
	});
});

describe('deriveFooter', () => {
	it('過渡中', () => {
		expect(deriveFooter('pending')).toBe('transitioning');
	});

	it('running：impaired → impaired，其餘 → healthy', () => {
		expect(deriveFooter('running', 'impaired')).toBe('impaired');
		expect(deriveFooter('running', 'ok')).toBe('healthy');
		expect(deriveFooter('running', 'insufficient-data')).toBe('healthy');
		expect(deriveFooter('running')).toBe('healthy');
	});

	it('stopped / terminated / unknown', () => {
		expect(deriveFooter('stopped')).toBe('stopped');
		expect(deriveFooter('terminated')).toBe('terminated');
		expect(deriveFooter('weird')).toBe('unknown');
	});
});

describe('hasMetric', () => {
	it('僅有限數字為 true', () => {
		expect(hasMetric(0)).toBe(true);
		expect(hasMetric(62.5)).toBe(true);
		expect(hasMetric(undefined)).toBe(false);
		expect(hasMetric(Number.NaN)).toBe(false);
		expect(hasMetric(Number.POSITIVE_INFINITY)).toBe(false);
	});
});

describe('availableMetrics', () => {
	it('依固定順序回傳有值的指標', () => {
		const rows = availableMetrics({ cpu: 62, mem: 45, disk: 28 });
		expect(rows.map(r => r.key)).toEqual(['cpu', 'mem', 'disk']);
		expect(rows.map(r => r.label)).toEqual(['CPU', 'MEM', 'DSK']);
		expect(rows.map(r => r.value)).toEqual([62, 45, 28]);
	});

	it('只有 CPU 時只回傳 CPU（沒裝 CloudWatch Agent）', () => {
		expect(availableMetrics({ cpu: 62 }).map(r => r.key)).toEqual(['cpu']);
	});

	it('完全沒有指標回傳空陣列', () => {
		expect(availableMetrics({})).toEqual([]);
	});

	it('保留 0 值（0% 也是有效資料）', () => {
		expect(availableMetrics({ cpu: 0 }).map(r => r.value)).toEqual([0]);
	});
});

describe('toDisplayMode', () => {
	it('接受四種合法模式', () => {
		expect(toDisplayMode('all')).toBe('all');
		expect(toDisplayMode('cpu')).toBe('cpu');
		expect(toDisplayMode('mem')).toBe('mem');
		expect(toDisplayMode('disk')).toBe('disk');
	});

	it('容忍大小寫與空白', () => {
		expect(toDisplayMode(' Disk ')).toBe('disk');
	});

	it('未設定或無法辨識回退為 all', () => {
		expect(toDisplayMode(undefined)).toBe('all');
		expect(toDisplayMode('')).toBe('all');
		expect(toDisplayMode('memory')).toBe('all');
	});
});

describe('chartMetricKey', () => {
	it('all 模式沒有線圖指標', () => {
		expect(chartMetricKey('all')).toBeNull();
	});

	it('單指標模式回傳對應的指標 key', () => {
		expect(chartMetricKey('cpu')).toBe('cpu');
		expect(chartMetricKey('mem')).toBe('mem');
		expect(chartMetricKey('disk')).toBe('disk');
	});
});

describe('metricLabel', () => {
	it('與 all 模式列標籤同一組字樣', () => {
		expect(metricLabel('cpu')).toBe('CPU');
		expect(metricLabel('mem')).toBe('MEM');
		expect(metricLabel('disk')).toBe('DSK');
	});
});
