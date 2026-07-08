/**
 * bump / release 的純函式（無 I/O），供 bump.mjs 使用並由 tests/release-lib.test.ts 覆蓋。
 */

const VERSION_RE = /^\d+\.\d+\.\d+\.\d+$/;
const BUMP_SEGMENTS = { major: 0, minor: 1, patch: 2, build: 3 };

/**
 * 計算下一個 4 段式版本（major.minor.patch.build）。
 * bump 可為關鍵字（major/minor/patch/build）或明確版本字串。
 * 進位某段時會將右側各段歸零。
 */
export const computeNextVersion = (current, bump) => {
	if (!VERSION_RE.test(current)) {
		throw new Error(`Invalid current version: ${current}`);
	}
	if (VERSION_RE.test(bump)) {
		return bump;
	}
	const idx = BUMP_SEGMENTS[bump];
	if (idx === undefined) {
		throw new Error(`Invalid bump keyword: ${bump} (expected major|minor|patch|build or x.y.z.w)`);
	}
	const parts = current.split('.').map(Number);
	parts[idx] += 1;
	for (let i = idx + 1; i < parts.length; i += 1) {
		parts[i] = 0;
	}
	return parts.join('.');
};

const MANIFEST_VERSION_RE = /("Version":\s*")[^"]*(")/;

/**
 * 只替換 manifest.json 中第一個（外掛）Version 值，保留其餘格式。
 * 以 pattern 是否存在判斷成功（而非文字是否改變），故新舊版本相同時仍冪等成功。
 * 找不到 Version 欄位時拋錯。
 */
export const replaceManifestVersion = (text, nextVersion) => {
	if (!MANIFEST_VERSION_RE.test(text)) {
		throw new Error("Version field not found in manifest.json");
	}
	return text.replace(MANIFEST_VERSION_RE, `$1${nextVersion}$2`);
};

// conventional commit 前綴 → CHANGELOG 分組
const TYPE_TO_GROUP = {
	feat: 'Features',
	fix: 'Bug Fixes',
	perf: 'Performance',
	refactor: 'Refactoring',
	docs: 'Documentation',
	chore: 'Chores',
	ci: 'Chores',
	build: 'Chores',
	test: 'Chores',
	style: 'Chores',
};

// 分組在 CHANGELOG 中的固定顯示順序
const GROUP_ORDER = ['Features', 'Bug Fixes', 'Performance', 'Refactoring', 'Documentation', 'Chores', 'Other'];

const CONVENTIONAL_RE = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/;
// release 流程自身產生的 commit，不列入 note
const RELEASE_NOISE_RE = /^chore: (release|bump version)\b/;

/**
 * 將單一 commit 標題分類到群組，並取出去除前綴後的描述。
 */
export const classifyCommit = (subject) => {
	const match = CONVENTIONAL_RE.exec(subject);
	if (!match) {
		return { group: 'Other', description: subject };
	}
	const [, type, description] = match;
	return { group: TYPE_TO_GROUP[type] ?? 'Other', description };
};

/**
 * 將 commit 陣列（{hash, subject}）分組，依 GROUP_ORDER 排序、
 * 略過空組與 release 噪音 commit。
 */
export const groupCommits = (commits) => {
	const buckets = new Map();
	for (const { hash, subject } of commits) {
		if (RELEASE_NOISE_RE.test(subject)) {
			continue;
		}
		const { group, description } = classifyCommit(subject);
		if (!buckets.has(group)) {
			buckets.set(group, []);
		}
		buckets.get(group).push({ description, hash });
	}
	return GROUP_ORDER
		.filter(title => buckets.has(title))
		.map(title => ({ title, entries: buckets.get(title) }));
};

/**
 * 產生單一版本的 Keep a Changelog 區塊（結尾含單一換行）。
 */
export const renderChangelogSection = (version, dateStr, groups) => {
	const lines = [`## [${version}] - ${dateStr}`, ''];
	if (groups.length === 0) {
		lines.push('- No notable changes.');
		return `${lines.join('\n')}\n`;
	}
	groups.forEach((group, index) => {
		lines.push(`### ${group.title}`, '');
		for (const entry of group.entries) {
			lines.push(`- ${entry.description} (${entry.hash})`);
		}
		if (index < groups.length - 1) {
			lines.push('');
		}
	});
	return `${lines.join('\n')}\n`;
};

const CHANGELOG_HEADER = '# Changelog\n\nAll notable changes to this project are documented in this file.\n';

/**
 * 將新版本區塊插入 CHANGELOG：空檔加表頭，否則插在表頭後、第一個舊版本區塊前。
 */
export const buildChangelog = (existing, section) => {
	const trimmed = existing.trim();
	if (!trimmed) {
		return `${CHANGELOG_HEADER}\n${section}`;
	}
	const firstEntryIdx = existing.indexOf('## [');
	if (firstEntryIdx === -1) {
		// 有表頭但尚無任何版本區塊
		return `${existing.replace(/\s*$/, '')}\n\n${section}`;
	}
	const header = existing.slice(0, firstEntryIdx).replace(/\s*$/, '');
	const rest = existing.slice(firstEntryIdx);
	return `${header}\n\n${section}\n${rest}`;
};

/**
 * 從 CHANGELOG 文字抽出指定版本的區塊（到下一個 `## [` 或檔尾為止），trim 後回傳；找不到回 null。
 */
export const extractVersionSection = (changelog, version) => {
	const lines = changelog.split('\n');
	const startIdx = lines.findIndex(line => line.startsWith(`## [${version}]`));
	if (startIdx === -1) {
		return null;
	}
	let endIdx = lines.length;
	for (let i = startIdx + 1; i < lines.length; i += 1) {
		if (lines[i].startsWith('## [')) {
			endIdx = i;
			break;
		}
	}
	return lines.slice(startIdx, endIdx).join('\n').trim();
};
