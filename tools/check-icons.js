#!/usr/bin/env node
/*
 * manifest.json のアイコンを検証する。
 *
 *   node tools/check-icons.js
 *
 * 確認する内容:
 *   1. ファイルが存在し、PNG として読めるか
 *   2. 実際の寸法が manifest の "sizes" と一致するか
 *   3. 絵柄(背景色でないピクセル)が中央にあるか
 *   4. 同じ purpose の中で、サイズ違いの絵柄の占有率が揃っているか
 *
 * 4 は「寸法は正しいが中身が切れている」アイコンを捕まえるためのもの。
 * headless ブラウザでの書き出しは、ウィンドウ幅の下限などで
 * 絵柄が切り取られても寸法だけは正しく出てしまうことがある。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

// 背景色との差がこの値以下のピクセルは「背景」とみなす
const BG_TOLERANCE = 12;
// 絵柄の中心が画像中心からこれ以上ずれていたら警告 (px)
const CENTER_TOLERANCE = 2;
// 同じ purpose 内で許容する占有率の差 (ポイント)
const SPAN_TOLERANCE = 3;

function parseColor(hex) {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
	if (!m) return [0x12, 0x12, 0x12];
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function decodePng(file) {
	const buf = fs.readFileSync(file);
	if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG ではありません');
	let off = 8;
	let width, height, depth, ctype;
	const idat = [];
	while (off < buf.length) {
		const len = buf.readUInt32BE(off);
		const type = buf.toString('ascii', off + 4, off + 8);
		const data = buf.subarray(off + 8, off + 8 + len);
		if (type === 'IHDR') {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			depth = data[8];
			ctype = data[9];
		} else if (type === 'IDAT') {
			idat.push(data);
		} else if (type === 'IEND') {
			break;
		}
		off += 12 + len;
	}
	if (depth !== 8 || (ctype !== 2 && ctype !== 6)) {
		throw new Error(`未対応の PNG 形式です (bit depth ${depth} / color type ${ctype})`);
	}

	const bpp = ctype === 6 ? 4 : 3;
	const stride = width * bpp;
	const raw = zlib.inflateSync(Buffer.concat(idat));
	const px = Buffer.alloc(height * stride);
	let pos = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[pos++];
		const line = raw.subarray(pos, pos + stride);
		pos += stride;
		const cur = px.subarray(y * stride, (y + 1) * stride);
		const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
		for (let i = 0; i < stride; i++) {
			const a = i >= bpp ? cur[i - bpp] : 0;
			const b = prev[i];
			const c = i >= bpp ? prev[i - bpp] : 0;
			let v = line[i];
			if (filter === 1) v += a;
			else if (filter === 2) v += b;
			else if (filter === 3) v += (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			cur[i] = v & 0xff;
		}
	}
	return { width, height, bpp, px };
}

// 背景色でないピクセルの外接矩形を求める
function measure(image, bg) {
	const { width, height, bpp, px } = image;
	let minX = width, minY = height, maxX = -1, maxY = -1, count = 0;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * bpp;
			const opaque = bpp === 3 || px[i + 3] > 16;
			const differs =
				Math.abs(px[i] - bg[0]) > BG_TOLERANCE ||
				Math.abs(px[i + 1] - bg[1]) > BG_TOLERANCE ||
				Math.abs(px[i + 2] - bg[2]) > BG_TOLERANCE;
			if (opaque && differs) {
				count++;
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}
	if (maxX < 0) return null;
	return {
		minX, minY, maxX, maxY,
		spanX: (maxX - minX + 1) / width,
		spanY: (maxY - minY + 1) / height,
		offsetX: (minX + maxX) / 2 - (width - 1) / 2,
		offsetY: (minY + maxY) / 2 - (height - 1) / 2,
		coverage: count / (width * height)
	};
}

const bg = parseColor(manifest.background_color);
const problems = [];
const byPurpose = new Map();

for (const icon of manifest.icons || []) {
	const label = `${icon.src} (${icon.purpose || 'any'})`;
	const file = path.join(root, icon.src);

	if (!fs.existsSync(file)) {
		problems.push(`${label}: ファイルがありません`);
		continue;
	}
	if (!/\.png$/i.test(icon.src)) {
		console.log(`${label.padEnd(40)} SKIP  PNG ではないため未検査`);
		continue;
	}

	let image, m;
	try {
		image = decodePng(file);
		m = measure(image, bg);
	} catch (e) {
		problems.push(`${label}: ${e.message}`);
		continue;
	}

	const actual = `${image.width}x${image.height}`;
	const notes = [];
	if (icon.sizes && icon.sizes !== 'any' && icon.sizes !== actual) {
		problems.push(`${label}: sizes は "${icon.sizes}" だが実際は ${actual}`);
		notes.push('サイズ不一致');
	}
	if (!m) {
		problems.push(`${label}: 背景色以外のピクセルがありません(真っ白/真っ黒の可能性)`);
		notes.push('絵柄なし');
	} else {
		if (Math.abs(m.offsetX) > CENTER_TOLERANCE || Math.abs(m.offsetY) > CENTER_TOLERANCE) {
			problems.push(
				`${label}: 絵柄が中央からずれています ` +
				`(x ${m.offsetX.toFixed(1)}px / y ${m.offsetY.toFixed(1)}px)`
			);
			notes.push('中央でない');
		}
		const key = icon.purpose || 'any';
		if (!byPurpose.has(key)) byPurpose.set(key, []);
		byPurpose.get(key).push({ label, spanX: m.spanX });
	}

	console.log(
		`${label.padEnd(40)} ${actual.padEnd(9)}` +
		(m
			? `絵柄 ${(m.spanX * 100).toFixed(1)}% / 中心ずれ ${m.offsetX.toFixed(1)},${m.offsetY.toFixed(1)}px / 占有 ${(m.coverage * 100).toFixed(1)}%`
			: '絵柄なし') +
		(notes.length ? `  <-- ${notes.join(' / ')}` : '')
	);
}

// 同じ purpose なら、サイズが違っても絵柄の占有率は揃うはず
for (const [purpose, entries] of byPurpose) {
	if (entries.length < 2) continue;
	const spans = entries.map((e) => e.spanX * 100);
	const diff = Math.max(...spans) - Math.min(...spans);
	if (diff > SPAN_TOLERANCE) {
		problems.push(
			`purpose="${purpose}": サイズ間で絵柄の大きさが揃っていません ` +
			`(${entries.map((e, i) => `${e.label} ${spans[i].toFixed(1)}%`).join(' / ')})。` +
			'どれかが切れている可能性があります。'
		);
	}
}

console.log('');
if (problems.length) {
	console.error('NG:');
	for (const p of problems) console.error('  - ' + p);
	process.exit(1);
}
console.log('OK: manifest のアイコンはすべて問題ありません。');
