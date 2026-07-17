import { describe, expect, it } from 'vitest';
import {
	buildChangelog,
	classifyCommit,
	computeNextVersion,
	extractVersionSection,
	groupCommits,
	parseCommitLines,
	renderChangelogSection,
	replaceManifestVersion,
} from '../scripts/release-lib.mjs';

describe('computeNextVersion', () => {
	it('major bump 進位並將右側歸零', () => {
		expect(computeNextVersion('1.1.2.3', 'major')).toBe('2.0.0.0');
	});
	it('minor bump', () => {
		expect(computeNextVersion('1.1.0.0', 'minor')).toBe('1.2.0.0');
	});
	it('patch bump', () => {
		expect(computeNextVersion('1.1.0.0', 'patch')).toBe('1.1.1.0');
	});
	it('build bump', () => {
		expect(computeNextVersion('1.1.0.0', 'build')).toBe('1.1.0.1');
	});
	it('明確版本字串直接採用', () => {
		expect(computeNextVersion('1.1.0.0', '1.5.2.0')).toBe('1.5.2.0');
	});
	it('無效的當前版本格式拋錯', () => {
		expect(() => computeNextVersion('1.0.0', 'minor')).toThrow();
	});
	it('無效的 bump 關鍵字拋錯', () => {
		expect(() => computeNextVersion('1.0.0.0', 'nope')).toThrow();
	});
});

describe('classifyCommit', () => {
	it('feat → Features 並去除前綴', () => {
		expect(classifyCommit('feat: add thing')).toEqual({ group: 'Features', description: 'add thing' });
	});
	it('帶 scope 與 breaking (!) 也能解析', () => {
		expect(classifyCommit('feat(polling)!: rework')).toEqual({ group: 'Features', description: 'rework' });
	});
	it('fix → Bug Fixes', () => {
		expect(classifyCommit('fix: y').group).toBe('Bug Fixes');
	});
	it('ci/chore → Chores', () => {
		expect(classifyCommit('ci: bump actions').group).toBe('Chores');
		expect(classifyCommit('chore: tidy').group).toBe('Chores');
	});
	it('無 conventional 前綴 → Other，保留原文', () => {
		expect(classifyCommit('random subject')).toEqual({ group: 'Other', description: 'random subject' });
	});
});

describe('groupCommits', () => {
	it('依固定順序分組、略過空組、略過 release 噪音 commit', () => {
		const groups = groupCommits([
			{ hash: 'aaa', subject: 'feat: A' },
			{ hash: 'bbb', subject: 'fix: B' },
			{ hash: 'ccc', subject: 'feat: C' },
			{ hash: 'ddd', subject: 'chore: release v1.1.0.0' },
			{ hash: 'eee', subject: 'chore: bump version to 1.1.0.0' },
		]);
		expect(groups).toEqual([
			{ title: 'Features', entries: [
				{ description: 'A', hash: 'aaa' },
				{ description: 'C', hash: 'ccc' },
			] },
			{ title: 'Bug Fixes', entries: [
				{ description: 'B', hash: 'bbb' },
			] },
		]);
	});
});

describe('parseCommitLines', () => {
	it('解析 tab 分隔的 hash 與 subject', () => {
		expect(parseCommitLines('aaa\tfeat: A\nbbb\tfix: B')).toEqual([
			{ hash: 'aaa', subject: 'feat: A' },
			{ hash: 'bbb', subject: 'fix: B' },
		]);
	});
	it('空輸入回傳空陣列', () => {
		expect(parseCommitLines('')).toEqual([]);
		expect(parseCommitLines('\n\n')).toEqual([]);
	});
	it('subject 內的 tab 原樣保留', () => {
		expect(parseCommitLines('aaa\tfeat: A\tB')).toEqual([{ hash: 'aaa', subject: 'feat: A\tB' }]);
	});
});

describe('renderChangelogSection', () => {
	it('輸出 Keep a Changelog 區塊', () => {
		const section = renderChangelogSection('1.2.0.0', '2026-07-08', [
			{ title: 'Features', entries: [{ description: 'auto-detect', hash: '2870e3e' }] },
		]);
		expect(section).toBe(
			'## [1.2.0.0] - 2026-07-08\n\n### Features\n\n- auto-detect (2870e3e)\n',
		);
	});
	it('無任何變更時仍輸出佔位行', () => {
		const section = renderChangelogSection('1.2.0.0', '2026-07-08', []);
		expect(section).toBe('## [1.2.0.0] - 2026-07-08\n\n- No notable changes.\n');
	});
});

describe('buildChangelog', () => {
	it('空檔案 → 加表頭與區塊', () => {
		const out = buildChangelog('', '## [1.0.0.0] - 2026-07-08\n\n- x\n');
		expect(out.startsWith('# Changelog')).toBe(true);
		expect(out).toContain('## [1.0.0.0] - 2026-07-08');
	});
	it('已有內容 → 新區塊插在表頭後、舊區塊前', () => {
		const existing = '# Changelog\n\nintro\n\n## [1.0.0.0] - 2026-01-01\n\n- old\n';
		const out = buildChangelog(existing, '## [1.1.0.0] - 2026-07-08\n\n- new\n');
		expect(out.indexOf('## [1.1.0.0]')).toBeLessThan(out.indexOf('## [1.0.0.0]'));
		expect(out).toContain('intro');
	});
});

describe('replaceManifestVersion', () => {
	const manifest = [
		'{',
		'\t"Name": "AWS Monitor",',
		'\t"Version": "1.1.0.0",',
		'\t"Nodejs": {',
		'\t\t"Version": "20"',
		'\t}',
		'}',
		'',
	].join('\n');

	it('只替換第一個（外掛）Version，不動 Nodejs 的 "20"', () => {
		const out = replaceManifestVersion(manifest, '1.2.0.0');
		expect(out).toContain('"Version": "1.2.0.0"');
		expect(out).toContain('"Version": "20"');
	});

	it('新版本與現值相同時視為成功（冪等），不拋錯', () => {
		expect(replaceManifestVersion(manifest, '1.1.0.0')).toBe(manifest);
	});

	it('找不到 Version 欄位時拋錯', () => {
		expect(() => replaceManifestVersion('{"Name":"x"}', '1.2.0.0')).toThrow();
	});
});

describe('extractVersionSection', () => {
	const changelog = [
		'# Changelog',
		'',
		'## [1.1.0.0] - 2026-07-08',
		'',
		'### Features',
		'',
		'- new (aaa)',
		'',
		'## [1.0.0.0] - 2026-01-01',
		'',
		'- old (bbb)',
		'',
	].join('\n');

	it('抽出指定版本區塊（不含下一個版本標題）', () => {
		expect(extractVersionSection(changelog, '1.1.0.0')).toBe(
			'## [1.1.0.0] - 2026-07-08\n\n### Features\n\n- new (aaa)',
		);
	});
	it('最後一個版本抽到檔尾', () => {
		expect(extractVersionSection(changelog, '1.0.0.0')).toBe(
			'## [1.0.0.0] - 2026-01-01\n\n- old (bbb)',
		);
	});
	it('找不到版本回傳 null', () => {
		expect(extractVersionSection(changelog, '9.9.9.9')).toBeNull();
	});
});
