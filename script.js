import * as Y from "https://esm.sh/yjs@13.6.18";
import { WebrtcProvider } from "https://esm.sh/y-webrtc@10.3.0?deps=yjs@13.6.18";
import { IndexeddbPersistence } from "https://esm.sh/y-indexeddb@9.0.12?deps=yjs@13.6.18";

const $ = (s) => document.querySelector(s),
	ed = $("#ed");
const ls = {
	get: (k) => {
		try {
			return localStorage.getItem(k);
		} catch {
			return null;
		}
	},
	set: (k, v) => {
		try {
			localStorage.setItem(k, v);
		} catch {}
	},
};
const rnd = () =>
	Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
		(b % 36).toString(36),
	).join("");
const room = location.hash.slice(1) || ls.get("naskah:last") || rnd();
location.hash = room;
ls.set("naskah:last", room);

/* ---------- Dokumen bersama (Yjs): teks polos berformat Fountain ---------- */
const doc = new Y.Doc(),
	ytext = doc.getText("script"),
	ymeta = doc.getMap("meta"); // nama script (ikut tersinkron ke kolaborator)
const MAX_UNDO = 30; // riwayat urungkan: hanya perubahanmu sendiri, bukan milik kolaborator
const um = new Y.UndoManager(ytext, {
	trackedOrigins: new Set(["local", "import"]),
	captureTimeout: 600,
});
const idb = new IndexeddbPersistence("naskah-" + room, doc);
/* WebRTC hanya aktif bila ada server signaling sendiri. Alamatnya diisi lewat tombol "Server"
			   di web dan disimpan di database (kolom signaling pada naskah / proyek), bukan di config.js.
			   Urutan sumber: ?signal= di tautan  >  alamat naskah  >  alamat proyek  >  cache terakhir.
			   Alamat berubah-ubah (mis. ngrok), jadi provider dibuat ulang saat berganti. */
const sigQ = new URLSearchParams(location.search).get("signal");
const SIG_CACHE = "naskah:signaling:" + room; // cache per naskah (dipakai saat database tak terjangkau)
// alamat dari database: milik naskah ini dan milik proyeknya (yang dipakai: naskah, kalau kosong proyek)
const sigSrc = {
	script: "",
	project: "",
	pid: null,
	pname: "",
	sowner: null, // id pemilik naskah (null = naskah belum ada di akun)
	powner: null,
};
const parseSigs = (t) =>
	String(t || "")
		.split(/[\s,]+/)
		.map((x) =>
			x
				.trim()
				.replace(/^https:\/\//i, "wss://")
				.replace(/^http:\/\//i, "ws://")
				.replace(/\/+$/, ""),
		)
		.filter((x) => /^wss?:\/\//i.test(x));
let provider = null,
	sigList = [],
	sigChanged = () => {};
const myColor = `hsl(${Math.floor(Math.random() * 360)} 65% 60%)`;
const me = () => ({
	name: $("#name").value.trim() || "Anonim",
	color: myColor,
});
let presenceTrack = null;
function showPeers(us) {
	$("#peers").innerHTML = us.length
		? us
				.map(
					(u) =>
						`<span class="dot" style="background:${u.color}" title="${String(u.name).replace(/[<&"]/g, "")}"></span>`,
				)
				.join("") + ` ${us.length} online`
		: "";
}
$("#name").value = ls.get("naskah:name") || "";
const setUser = () => {
	if (provider) provider.awareness.setLocalStateField("user", me());
	if (presenceTrack) presenceTrack();
};
$("#name").oninput = () => {
	ls.set("naskah:name", $("#name").value);
	setUser();
};
setUser();
function setSignaling(urls) {
	urls = [...new Set(urls)];
	if (JSON.stringify(urls) === JSON.stringify(sigList)) return;
	sigList = urls;
	const had = !!provider;
	if (provider) {
		provider.destroy();
		provider = null;
	}
	if (urls.length) {
		const pv = new WebrtcProvider("naskah-" + room, doc, {
			password: room,
			signaling: urls,
		});
		provider = pv;
		pv.awareness.on("change", () =>
			showPeers(
				[...pv.awareness.getStates().values()]
					.map((x) => x.user)
					.filter(Boolean),
			),
		);
		setUser();
	} else if (had) showPeers([]);
	sigChanged();
}
// alamat efektif: milik naskah ini, kalau kosong milik proyeknya
function applySig() {
	const own = parseSigs(sigSrc.script),
		l = own.length ? own : parseSigs(sigSrc.project);
	ls.set(SIG_CACHE, l.join("\n"));
	if (!sigQ) setSignaling(l); // ?signal= di tautan selalu menang
}
{
	const cached = parseSigs(ls.get(SIG_CACHE));
	setSignaling(sigQ ? [sigQ] : cached);
}

/* ---------- Dialog "Server realtime" ---------- */
const sdlg = $("#sdlg"),
	sMsg = (t) => ($("#smsg small").textContent = t),
	pName = () => `“${sigSrc.pname || "tanpa nama"}”`;
function srvStatus() {
	const on = provider && provider.signalingConns.some((c) => c.connected),
		src = parseSigs(sigSrc.script).length
			? "naskah ini"
			: parseSigs(sigSrc.project).length
				? "proyek " + pName()
				: "";
	$("#sst small").textContent =
		(sigList.length
			? on
				? "● Tersambung ke server"
				: "○ Mencoba menyambung…"
			: "Belum ada server: realtime WebRTC mati") +
		(sigQ
			? " · memakai ?signal= dari tautan"
			: src
				? " · alamat dari " + src
				: "");
}
sigChanged = () => {
	if (sdlg.open) srvStatus();
};
function srvBuild() {
	const sel = $("#sscope"),
		keep = sel.value;
	sel.replaceChildren(new Option("Untuk naskah ini", "script"));
	if (sigSrc.pid)
		sel.add(new Option("Untuk seluruh proyek " + pName(), "project"));
	sel.hidden = !sigSrc.pid;
	sel.value = keep === "project" && sigSrc.pid ? "project" : "script";
}
function srvFill() {
	const u = srvApi && srvApi.user(),
		sc = $("#sscope").value,
		can =
			!!u &&
			(sc === "project"
				? sigSrc.powner === u.id
				: sigSrc.sowner === u.id);
	$("#surl").value = sc === "project" ? sigSrc.project : sigSrc.script;
	$("#surl").readOnly = !can;
	$("#ssave").hidden = !can;
	sMsg(
		!u
			? "Masuk dulu untuk mengubah alamat."
			: sigSrc.sowner === null
				? "Naskah ini belum tersimpan di akun, jadi alamatnya belum bisa diatur."
				: can
					? sc === "project"
						? "Berlaku untuk semua naskah di proyek ini, kecuali naskah yang punya alamat sendiri."
						: "Tempel URL dari ngrok; https:// otomatis jadi wss://. Mengalahkan alamat proyek."
					: sc === "project"
						? "Hanya pemilik proyek yang bisa mengubah alamat proyek."
						: "Hanya pemilik naskah yang bisa mengubah alamat ini.",
	);
}
const srvErr = (e) => {
	const m = ((e && e.message) || "") + " " + ((e && e.code) || "");
	return /not_owner/.test(m)
		? "Hanya pemilik yang bisa mengubah."
		: /bad_url/.test(m)
			? "Alamat tidak valid. Contoh: https://xxxx.ngrok-free.app"
			: /too_many/.test(m)
				? "Maksimal 5 alamat."
				: /PGRST20|Could not find|does not exist/i.test(m)
					? "Jalankan schema_signaling.sql di Supabase dulu."
					: m.trim() || "Gagal.";
};
$("#srv").onclick = () => {
	if (!srvApi) {
		alert(
			"Alamat server disimpan di Supabase. Isi config.js (URL dan key Supabase) lebih dulu.",
		);
		return;
	}
	srvBuild();
	srvFill();
	srvStatus();
	sdlg.showModal();
	const tm = setInterval(srvStatus, 1000);
	sdlg.addEventListener("close", () => clearInterval(tm), {
		once: true,
	});
	srvApi.refresh().then(() => {
		if (!sdlg.open) return;
		srvBuild();
		srvFill();
		srvStatus();
	});
};

const side = $("#side"),
	tools = $("#tools");

document.querySelectorAll(".humberg_menu").forEach((a) => {
	a.onclick = () => {
		side.classList.toggle("hide");
	};
});
document.querySelectorAll(".tools_menu").forEach((a) => {
	a.onclick = () => {
		tools.classList.toggle("hide");
	};
});

$("#sscope").onchange = srvFill;
$("#ssave").onclick = async () => {
	const sc = $("#sscope").value;
	sMsg("Menyimpan…");
	const { data, error } = await srvApi.save(sc, $("#surl").value);
	if (error) return sMsg(srvErr(error));
	if (sc === "project") sigSrc.project = data || "";
	else sigSrc.script = data || "";
	$("#surl").value = data || "";
	applySig();
	srvStatus();
	sMsg(
		data
			? "Tersimpan. Kolaborator yang sedang membuka akan menyambung ulang otomatis."
			: "Dikosongkan.",
	);
};
$("#stest").onclick = () => {
	const urls = parseSigs($("#surl").value);
	if (!urls.length) return sMsg("Isi alamat dulu.");
	sMsg("Menguji…");
	Promise.all(
		urls.map(
			(u) =>
				new Promise((res) => {
					let w = null,
						done = false;
					const t = setTimeout(() => fin(false), 6000);
					function fin(ok) {
						if (done) return;
						done = true;
						clearTimeout(t);
						try {
							w && w.close();
						} catch {}
						res(`${ok ? "✓" : "✗"} ${u}`);
					}
					try {
						w = new WebSocket(u);
						w.onopen = () => fin(true);
						w.onerror = () => fin(false);
					} catch {
						fin(false);
					}
				}),
		),
	).then((r) => sMsg(r.join("   ")));
};

/* ---------- Klasifikasi baris -> elemen script ---------- */
const SCENE =
	/^(\.[^.]|(\d+[A-Za-z]?[.)]?\s+)?(INT|EXT|EST|INT\.?\/EXT|INT\/EXT|I\/E)[. ])/i; // boleh diawali nomor adegan: 1. INT. ...
const TRANS = /^>|^[A-Z0-9 .]+ TO:$|^FADE (IN|OUT)[.:]?$|^CUT TO BLACK\.?$/;
const caps = (s) => s === s.toUpperCase() && /[A-Z]/.test(s);
const speaker = (s) =>
	s
		.replace(/^@/, "")
		.replace(/\s*\(.*?\)/g, "")
		.trim()
		.toUpperCase();
function analyze(lines, kinds = []) {
	const max = +$("#max").value || 0,
		useCont = $("#cont").checked;
	let prev = "blank",
		last = null,
		acts = 0;
	return lines.map((t, idx) => {
		const s = t.trim(),
			r = { kind: "blank", cont: false };
		const ek = kinds[idx]; // jenis yang dipilih manual: tanpa tebakan, tanpa simbol
		if (ek) {
			r.kind = ek;
			if (ek === "scene" || ek === "transition") last = null;
			else if (ek === "character") {
				const n = speaker(s);
				if (
					useCont &&
					s &&
					last === n &&
					acts <= max &&
					!/CONT.?D/i.test(s)
				)
					r.cont = true;
				last = n;
				acts = 0;
			} else if (ek === "action") acts++;
			prev = ek;
			return r;
		}
		if (!s) {
			prev = "blank";
			return r;
		}
		if (SCENE.test(s)) {
			r.kind = "scene";
			last = null;
		} else if (TRANS.test(s)) {
			r.kind = "transition";
			last = null;
		} else if (s[0] === "!" || s[0] === "[") {
			r.kind = "action";
		} else if (prev === "character" || prev === "paren") {
			r.kind = /^\(/.test(s) ? "paren" : "dialogue";
		} else if (prev === "dialogue" && /^\(.*\)$/.test(s)) {
			r.kind = "paren";
		} else if (
			s[0] === "@" ||
			(caps(s) && s.length < 45 && (/\)$/.test(s) || !/[.!?:]$/.test(s)))
		) {
			r.kind = "character";
			const n = speaker(s);
			if (useCont && last === n && acts <= max && !/CONT.?D/i.test(s))
				r.cont = true;
			last = n;
			acts = 0;
		} else r.kind = "action";
		if (r.kind === "action") acts++;
		prev = r.kind;
		return r;
	});
}

/* ---------- Ukuran kertas & halaman terpisah (+ (MORE)/(CONT'D) di batas lembar) ---------- */
const PAPERS = {
	a4: { n: "A4", t: "A4 · 210 × 297 mm", w: 210, h: 297 },
	f4: { n: "F4 / Folio", t: "F4 · 210 × 330 mm", w: 210, h: 330 },
	letter: {
		n: "Letter",
		t: "Letter · 8,5 × 11 in",
		w: 215.9,
		h: 279.4,
	},
	legal: {
		n: "Legal",
		t: "Legal · 8,5 × 14 in",
		w: 215.9,
		h: 355.6,
	},
};
const EM_MM = (12 * 25.4) / 72, // 1em (12pt) dalam mm
	SHEET_GAP = 2, // jarak antar lembar (em)
	PAD_Y = 6; // margin atas/bawah lembar (em) = 1 inci
const KM = {
	scene: 1,
	action: 1,
	character: 1,
	dialogue: 0,
	paren: 0,
	transition: 1,
	blank: 0,
};
const paperEl = $(".paper"),
	pagesEl = $("#pages"),
	mainEl = $("main"),
	psize = $("#psize"),
	pgStyle = $("#pgsz"),
	fluidMQ = matchMedia("screen and (max-width: 820px)");
let paperKey = ls.get("naskah:paper");
if (!PAPERS[paperKey]) paperKey = "letter";
let pgCfg = null,
	pgLast = null;

/* Hitung letak tiap paragraf per lembar. Satuan: baris (1em). Fungsi murni. */
function pgLayout(items, ph, L) {
	const pitch = ph + SHEET_GAP,
		E = 1e-6,
		out = [],
		marks = [];
	const kmOf = (it) => KM[it.kind] || 0;
	const keepNeed = (i) => {
		const it = items[i];
		let need = it.lines,
			j = i + 1;
		while (items[j] && items[j].kind === "blank") j++;
		if (it.kind === "scene") {
			const n = items[j];
			if (n) need += kmOf(n) + Math.min(1, n.lines);
		} else if (it.kind === "character" || it.kind === "paren") {
			while (items[j] && items[j].kind === "paren") {
				need += items[j].lines;
				j++;
			}
			const n = items[j];
			if (n && n.kind === "dialogue") need += Math.min(2, n.lines);
		}
		return need;
	};
	let y = 0;
	for (let i = 0; i < items.length; i++) {
		const it = items[i],
			o = {};
		out.push(o);
		let top = y + (i === 0 ? 0 : kmOf(it));
		if (it.lines === 0) {
			y = top;
			continue;
		}
		let k = Math.max(0, Math.floor((y + E) / pitch));
		let end = k * pitch + L;
		let pushed = false;
		const toNext = () => {
			k++;
			top = k * pitch;
			end = k * pitch + L;
			pushed = true;
		};
		if (top > end - E) toNext();
		const atTop = () => top - k * pitch < E;
		const canSplit =
			(it.kind === "dialogue" || it.kind === "action") && it.lines >= 4;
		const trySplit = () => {
			const avail = Math.floor(end - top + E);
			const dlg = it.kind === "dialogue";
			let n1 = avail - (dlg ? 1 : 0);
			if (it.lines - n1 < 2) n1 = it.lines - 2;
			return canSplit && n1 >= 2 && it.lines > avail ? n1 : 0;
		};
		let avail = Math.floor(end - top + E);
		const holds =
			it.kind === "scene" ||
			it.kind === "character" ||
			it.kind === "paren";
		if (!atTop() && holds && keepNeed(i) > avail) {
			toNext();
			avail = Math.floor(end - top + E);
		}
		let n1 = 0;
		if (it.lines > avail) {
			n1 = trySplit();
			if (!n1 && !atTop()) {
				toNext();
				avail = Math.floor(end - top + E);
				if (it.lines > avail) n1 = trySplit();
			}
		}
		if (pushed) o.push = top - y;
		if (n1) {
			const dlg = it.kind === "dialogue",
				cue = dlg && it.name ? 1 : 0,
				next = (k + 1) * pitch;
			o.brk = { bo: n1, bh: next - (top + n1) + cue };
			if (dlg) marks.push({ y: top + n1, text: "(MORE)" });
			if (cue)
				marks.push({
					y: next,
					text: /\(CONT.?D\)\s*$/i.test(it.name)
						? it.name
						: it.name + " (CONT'D)",
				});
			y = next + cue + (it.lines - n1);
		} else y = top + it.lines;
	}
	return {
		out,
		marks,
		np: Math.max(1, Math.floor((y - 1e-4) / pitch) + 1),
		pitch,
	};
}

function paginate() {
	if (!pgCfg) return;
	const kids = [...ed.children];
	for (const p of kids) {
		if (p.hasAttribute("data-push")) {
			p.removeAttribute("data-push");
			p.style.removeProperty("--mt");
		}
		if (p.hasAttribute("data-brk")) {
			p.removeAttribute("data-brk");
			p.style.removeProperty("--bo");
			p.style.removeProperty("--bh");
		}
		if (p.getAttribute("style") === "") p.removeAttribute("style");
	}
	if (fluidMQ.matches) {
		pagesEl.replaceChildren();
		paperEl.style.height = "";
		ed.style.minHeight = "";
		pgLast = null;
		return;
	}
	const fs = parseFloat(getComputedStyle(ed).fontSize) || 16;
	let who = "";
	const items = kids.map((p) => {
		const kind = p.className.split(" ")[0] || "action";
		if (kind === "character")
			who = p.textContent
				.replace(/\s*\((CONT.?D|MORE)\)\s*$/i, "")
				.trim()
				.toUpperCase();
		else if (kind === "scene" || kind === "transition") who = "";
		return {
			kind,
			lines: Math.round(p.offsetHeight / fs),
			name: kind === "dialogue" ? who : "",
		};
	});
	const { ph, L } = pgCfg;
	const r = pgLayout(items, ph, L);
	pgLast = r;
	r.out.forEach((o, i) => {
		const p = kids[i];
		if (o.push != null) {
			p.setAttribute("data-push", "");
			p.style.setProperty("--mt", o.push);
		}
		if (o.brk) {
			p.setAttribute("data-brk", "");
			p.style.setProperty("--bo", o.brk.bo);
			p.style.setProperty("--bh", o.brk.bh);
		}
	});
	paperEl.style.height = `${(r.np - 1) * r.pitch + ph}em`;
	ed.style.minHeight = `${(r.np - 1) * r.pitch + L}em`;
	const frag = document.createDocumentFragment();
	for (let k = 0; k < r.np; k++) {
		const pg = document.createElement("div");
		pg.className = "pg";
		pg.style.top = `${k * r.pitch}em`;
		pg.style.height = `${ph}em`;
		if (k) {
			const n = document.createElement("span");
			n.className = "pn";
			n.textContent = `${k + 1}.`;
			pg.append(n);
		}
		frag.append(pg);
	}
	for (const m of r.marks) {
		const d = document.createElement("div");
		d.className = "mk";
		d.style.top = `${PAD_Y + m.y}em`;
		d.textContent = m.text;
		frag.append(d);
	}
	pagesEl.replaceChildren(frag);
}

function setPaper(key, save) {
	const P = PAPERS[key];
	paperKey = key;
	const pw = P.w / EM_MM,
		ph = P.h / EM_MM;
	pgCfg = { pw, ph, L: Math.floor(ph - 2 * PAD_Y + 1e-6) };
	paperEl.style.setProperty("--pw", pw.toFixed(3));
	paperEl.style.setProperty("--ph", ph.toFixed(3));
	pgStyle.textContent = `@page { size: ${P.w}mm ${P.h}mm; }`;
	psize.value = key;
	if (save) ls.set("naskah:paper", key);
	paginate();
}
for (const [k, P] of Object.entries(PAPERS)) {
	const o = document.createElement("option");
	o.value = k;
	o.textContent = P.n;
	o.title = P.t;
	psize.append(o);
}
psize.onchange = () => setPaper(psize.value, true);
fluidMQ.addEventListener("change", paginate);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(paginate);
setPaper(paperKey, false);

/* ---------- Cetak / PDF ----------
			   Tiap lembar layar dibuat ulang sebagai satu halaman kertas (margin @page = 0),
			   isinya salinan paragraf yang diletakkan di posisi yang sama persis dengan di layar,
			   jadi pemenggalan halaman, nomor halaman, (MORE) dan (CONT'D) ikut tercetak. */
const printRoot = $("#printroot");
const pageCss = (P, zero) =>
	`@page { size: ${P.w}mm ${P.h}mm;${zero ? " margin: 0;" : ""} }`;
function clearPrint() {
	printRoot.replaceChildren();
	document.body.classList.remove("pp");
	pgStyle.textContent = pageCss(PAPERS[paperKey], false);
}
function buildPrint() {
	paginate();
	if (!pgLast || !pgCfg || fluidMQ.matches) return clearPrint();
	const P = PAPERS[paperKey],
		r = pgLast,
		fs = parseFloat(getComputedStyle(ed).fontSize) || 16,
		top0 = ed.getBoundingClientRect().top;
	const boxes = [...ed.children]
		.map((p) => {
			const b = p.getBoundingClientRect();
			return { p, y: (b.top - top0) / fs, h: b.height / fs };
		})
		.filter((b) => b.h > 0.01);
	const frag = document.createDocumentFragment();
	for (let k = 0; k < r.np; k++) {
		const lo = k * r.pitch,
			hi = lo + r.pitch;
		const sh = document.createElement("div");
		sh.className = "psheet";
		sh.style.width = `${P.w}mm`;
		sh.style.height = `calc(${P.h}mm - 1px)`;
		if (k) {
			const n = document.createElement("span");
			n.className = "pn";
			n.textContent = `${k + 1}.`;
			sh.append(n);
		}
		const pin = document.createElement("div");
		pin.className = "pin";
		pin.style.width = `${pgCfg.pw - 15}em`;
		for (const b of boxes) {
			if (b.y >= hi - 1e-6 || b.y + b.h <= lo + 1e-6) continue;
			const c = b.p.cloneNode(true);
			c.removeAttribute("id");
			c.classList.remove("cur");
			c.style.top = `${b.y - lo}em`;
			pin.append(c);
		}
		sh.append(pin);
		for (const m of r.marks) {
			if (Math.floor((m.y + 1e-6) / r.pitch) !== k) continue;
			const d = document.createElement("div");
			d.className = "mk";
			d.style.top = `${PAD_Y + m.y - lo}em`;
			d.textContent = m.text;
			sh.append(d);
		}
		frag.append(sh);
	}
	printRoot.replaceChildren(frag);
	pgStyle.textContent = pageCss(P, true);
	document.body.classList.add("pp");
}
addEventListener("beforeprint", buildPrint);
addEventListener("afterprint", clearPrint);

/* ---------- Unduh PDF langsung (jsPDF) ----------
			   Tata letak dihitung ulang di wadah tersembunyi berukuran kertas asli (12pt),
			   lalu tiap baris digambar ke PDF di koordinat yang sama dengan lembar di layar.
			   Tidak lewat mesin cetak browser, jadi tidak ada dialog dan tidak ada margin tambahan. */
const JSPDF_URL =
	"https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const PDF_BASE = 0.72; // posisi baseline Courier Prime dalam baris 1em
function loadJsPDF() {
	if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
	return new Promise((ok, no) => {
		const sc = document.createElement("script");
		sc.src = JSPDF_URL;
		sc.onload = () =>
			window.jspdf ? ok(window.jspdf.jsPDF) : no(new Error("jsPDF"));
		sc.onerror = () => no(new Error("jsPDF tidak bisa dimuat"));
		document.head.append(sc);
	});
}
/* Susun naskah di wadah luar layar lalu kembalikan baris-baris siap gambar. */
function pdfLayout() {
	const { pw, ph, L } = pgCfg;
	const host = document.createElement("div");
	host.style.cssText =
		"position:absolute;left:-99999px;top:0;visibility:hidden;" +
		'font:12pt/1 "Courier Prime",Courier,monospace;text-rendering:geometricPrecision;' +
		`width:${pw - 15}em`;
	const pin = document.createElement("div");
	pin.className = "pin";
	pin.style.cssText = `position:relative;width:${pw - 15}em`;
	host.append(pin);
	const kids = [...ed.children].map((p) => {
		const c = p.cloneNode(true);
		for (const a of ["data-push", "data-brk", "id"]) c.removeAttribute(a);
		for (const v of ["--mt", "--bo", "--bh"]) c.style.removeProperty(v);
		c.classList.remove("cur");
		pin.append(c);
		return c;
	});
	document.body.append(host);
	try {
		const fs = parseFloat(getComputedStyle(pin).fontSize) || 16;
		let who = "";
		const items = kids.map((p) => {
			const kind = p.className.split(" ")[0] || "action";
			if (kind === "character")
				who = p.textContent
					.replace(/\s*\((CONT.?D|MORE)\)\s*$/i, "")
					.trim()
					.toUpperCase();
			else if (kind === "scene" || kind === "transition") who = "";
			return {
				kind,
				lines: Math.round(p.offsetHeight / fs),
				name: kind === "dialogue" ? who : "",
			};
		});
		const r = pgLayout(items, ph, L);
		r.out.forEach((o, i) => {
			const p = kids[i];
			if (o.push != null) {
				p.setAttribute("data-push", "");
				p.style.setProperty("--mt", o.push);
			}
			if (o.brk) {
				p.setAttribute("data-brk", "");
				p.style.setProperty("--bo", o.brk.bo);
				p.style.setProperty("--bh", o.brk.bh);
			}
		});
		/* ambil tiap baris visual (teks, posisi) lewat Range per karakter */
		const base = pin.getBoundingClientRect(),
			rg = document.createRange(),
			raw = [];
		let delta = null; // selisih bagian atas glyph terhadap bagian atas baris
		for (const p of kids) {
			const pr = p.getBoundingClientRect();
			if (pr.height < 1) continue;
			const cs = getComputedStyle(p),
				bold = parseInt(cs.fontWeight, 10) >= 600,
				upper = cs.textTransform === "uppercase";
			const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
			let cur = null,
				first = true;
			for (let n; (n = tw.nextNode()); ) {
				const t = n.nodeValue;
				for (let i = 0; i < t.length; i++) {
					let ch = t[i];
					if (ch < " ") continue; // buang \n, \t, dll.
					if (upper) ch = ch.toUpperCase();
					rg.setStart(n, i);
					rg.setEnd(n, i + 1);
					const rc = rg.getClientRects()[0];
					const hang = /\s/.test(ch) && (!rc || rc.width < 0.5);
					if (!rc || hang) {
						if (cur) cur.text += ch;
						continue;
					}
					const y = (rc.top - base.top) / fs;
					if (!cur || Math.abs(y - cur.y) > 0.4) {
						cur = {
							y,
							x: (rc.left - base.left) / fs,
							text: "",
							bold,
						};
						raw.push(cur);
						if (
							first &&
							delta === null &&
							!p.hasAttribute("data-brk")
						)
							delta = y - (pr.top - base.top) / fs;
						first = false;
					}
					cur.text += ch;
				}
			}
			if (p.hasAttribute("data-cont") && cur) cur.text += " (CONT'D)";
		}
		delta = delta || 0;
		const lines = raw
			.map((l) => ({
				...l,
				y: l.y - delta,
				text: l.text.replace(/\s+$/, ""),
			}))
			.filter((l) => l.text);
		return { lines, marks: r.marks, np: r.np, pitch: r.pitch };
	} finally {
		host.remove();
	}
}
/* Fungsi murni: gambar baris-baris ke dokumen jsPDF. */
function drawPdf(doc, lay, P, pw) {
	const PT = 72 / 25.4,
		EM = 12,
		W = P.w * PT,
		H = P.h * PT;
	const k0 = (y) => Math.max(0, Math.floor((y + 0.25) / lay.pitch));
	for (let k = 1; k < lay.np; k++) doc.addPage([W, H]);
	doc.setFontSize(EM);
	doc.setTextColor(0);
	let font = "";
	const use = (b) => {
		const f = b ? "bold" : "normal";
		if (f !== font) doc.setFont("CourierPrime", f);
		font = f;
	};
	for (let k = 0; k < lay.np; k++) {
		doc.setPage(k + 1);
		if (k) {
			use(false);
			doc.text(`${k + 1}.`, W - 6 * EM, (3 + PDF_BASE) * EM, {
				align: "right",
			});
		}
	}
	for (const l of lay.lines) {
		const k = Math.min(lay.np - 1, k0(l.y)),
			rel = Math.round(l.y - k * lay.pitch);
		doc.setPage(k + 1);
		use(l.bold);
		doc.text(l.text, (9 + l.x) * EM, (PAD_Y + rel + PDF_BASE) * EM);
	}
	for (const m of lay.marks) {
		const k = Math.min(lay.np - 1, k0(m.y));
		doc.setPage(k + 1);
		use(false);
		doc.text(
			m.text.toUpperCase(),
			(9 + 22 * 0.5996) * EM,
			(PAD_Y + Math.round(m.y - k * lay.pitch) + PDF_BASE) * EM,
		);
	}
}
async function downloadPdf() {
	if (!pgCfg) return;
	const btn = $("#pdf");
	btn.disabled = true;
	flash("Menyiapkan PDF…");
	try {
		const [jsPDF] = await Promise.all([
			loadJsPDF(),
			document.fonts ? document.fonts.ready : null,
		]);
		const P = PAPERS[paperKey],
			PT = 72 / 25.4;
		const doc = new jsPDF({
			unit: "pt",
			format: [P.w * PT, P.h * PT],
			orientation: "portrait",
			compress: true,
		});
		for (const [id, w] of [
			["fnt-reg", "normal"],
			["fnt-bold", "bold"],
		]) {
			const f = `CourierPrime-${w}.ttf`;
			doc.addFileToVFS(f, $("#" + id).textContent.trim());
			doc.addFont(f, "CourierPrime", w);
		}
		drawPdf(doc, pdfLayout(), P, pgCfg.pw);
		const title =
			$("#sname").value.trim() ||
			(ed.querySelector("p")?.textContent || "").trim() ||
			"naskah";
		doc.setProperties({ title });
		doc.save(
			title
				.replace(/[\\/:*?"<>|\s]+/g, "-")
				.slice(0, 60)
				.replace(/^-+|-+$/g, "") || "naskah",
		);
		flash("PDF terunduh ✓");
	} catch (e) {
		console.error(e);
		flash("Gagal membuat PDF (" + e.message + "). Coba tombol Cetak.");
	} finally {
		btn.disabled = false;
	}
}
$("#pdf").onclick = downloadPdf;

/* ---------- Format baris disimpan sebagai atribut (bukan simbol di teks) ----------
			   Teks dokumen = baris-baris bersih, tiap baris diakhiri "\n". Jenis baris yang dipilih
			   manual disimpan sebagai atribut "k" pada karakter "\n" penutup barisnya. Tanpa atribut
			   = jenis ditebak otomatis. */
const KIND_LIST = [
	"scene",
	"action",
	"character",
	"dialogue",
	"paren",
	"transition",
];
function readDoc() {
	const L = [""],
		K = [null];
	for (const op of ytext.toDelta()) {
		if (typeof op.insert !== "string") continue;
		const k =
			op.attributes && KIND_LIST.includes(op.attributes.k)
				? op.attributes.k
				: null;
		op.insert.split("\n").forEach((part, i) => {
			if (i) {
				K[L.length - 1] = k;
				L.push("");
				K.push(null);
			}
			L[L.length - 1] += part;
		});
	}
	if (L.length > 1 && L[L.length - 1] === "") {
		L.pop();
		K.pop();
	}
	return { L, K };
}
/* samakan dokumen Yjs dengan keadaan editor (teks + jenis baris) */
function pushState(L, K) {
	const a = ytext.toString(),
		b = L.join("\n") + "\n";
	doc.transact(() => {
		if (a !== b) {
			let i = 0;
			while (i < a.length && i < b.length && a[i] === b[i]) i++;
			let j = 0;
			while (
				j < a.length - i &&
				j < b.length - i &&
				a[a.length - 1 - j] === b[b.length - 1 - j]
			)
				j++;
			ytext.delete(i, a.length - i - j);
			ytext.insert(i, b.slice(i, b.length - j), { k: null });
		}
		const cur = readDoc();
		let off = 0;
		L.forEach((t, i) => {
			const idx = off + t.length;
			off = idx + 1;
			const want = K[i] || null;
			if ((cur.K[i] || null) !== want && idx < ytext.length)
				ytext.format(idx, 1, { k: want });
		});
		if (ymeta.get("fmt") !== 2) ymeta.set("fmt", 2);
	}, "local");
}
/* tulis banyak baris sekaligus (impor) */
function writeLines(L, K, mode) {
	doc.transact(() => {
		let base = 0;
		if (mode === "append") {
			const s = ytext.toString();
			if (s && !s.endsWith("\n"))
				ytext.insert(s.length, "\n", { k: null });
			base = ytext.length;
		} else ytext.delete(0, ytext.length);
		ytext.insert(base, L.join("\n") + "\n", { k: null });
		let off = base;
		L.forEach((t, i) => {
			const idx = off + t.length;
			off = idx + 1;
			if (K[i]) ytext.format(idx, 1, { k: K[i] });
		});
		if (ymeta.get("fmt") !== 2) ymeta.set("fmt", 2);
	}, "import");
}
/* naskah lama: simbol @ ! . > di awal baris dibuang, jenisnya jadi atribut (sekali saja) */
function migrateLegacy() {
	if (ymeta.get("fmt") === 2) return;
	const s = ytext.toString();
	if (!s.trim()) return;
	const { L, K } = readDoc(),
		A = analyze(L, []),
		SYM = /^\s*[.!@>](?![.!@>])\s?/,
		starts = [];
	let o = 0;
	L.forEach((t) => {
		starts.push(o);
		o += t.length + 1;
	});
	doc.transact(() => {
		if (!s.endsWith("\n")) ytext.insert(s.length, "\n", { k: null });
		for (let i = L.length - 1; i >= 0; i--) {
			const m = !K[i] && L[i].match(SYM);
			if (!m) continue;
			ytext.delete(starts[i], m[0].length);
			if (KIND_LIST.includes(A[i].kind))
				ytext.format(starts[i] + L[i].length - m[0].length, 1, {
					k: A[i].kind,
				});
		}
		ymeta.set("fmt", 2);
	}, "migrate");
}

/* ---------- Render & sinkronisasi ---------- */
const lines = () => [...ed.children].map((p) => p.textContent);
const kinds = () => [...ed.children].map((p) => p.dataset.k || null);
const getText = () => lines().join("\n");
function restyle() {
	const L = lines(),
		A = analyze(L, kinds());
	[...ed.children].forEach((p, i) => {
		p.className = A[i].kind + (p === curEl ? " cur" : "");
		A[i].cont
			? p.setAttribute("data-cont", "")
			: p.removeAttribute("data-cont");
	});
	const empty = L.length <= 1 && !L[0];
	empty
		? ed.setAttribute("data-empty", "")
		: ed.removeAttribute("data-empty");
	if (empty && ed.firstChild)
		ed.firstChild.dataset.ph =
			"Mulai menulis… ketik INT. RUMAH - MALAM, lalu cerita mengalir.";
	const words = L.join(" ").split(/\s+/).filter(Boolean).length;
	renderNav(L, A);
	saveMeta();
	$("#st").textContent =
		`${A.filter((a) => a.kind === "scene").length} adegan · ${words} kata`;
	paginate();
	track();
}
function mk(t) {
	const p = document.createElement("p");
	t ? (p.textContent = t) : (p.innerHTML = "<br>");
	return p;
}
const rows = (L, K) =>
	L.map((t, i) => {
		const p = mk(t);
		if (K[i]) p.dataset.k = K[i];
		return p;
	});
function render() {
	const { L, K } = readDoc();
	ed.replaceChildren(...rows(L, K));
	restyle();
}
function push() {
	pushState(lines(), kinds());
}
function normalize() {
	for (const n of [...ed.childNodes])
		if (n.nodeName !== "P") {
			const p = document.createElement("p");
			n.replaceWith(p);
			p.append(n.nodeType === 3 ? n : n.textContent);
		}
	if (!ed.children.length) ed.append(mk(""));
}
const onInput = () => {
	normalize();
	restyle();
	push();
	$("#sync").textContent = "tersimpan di perangkat";
	suggest();
};
ed.addEventListener("input", onInput);

/* caret <-> offset (agar kursor tidak lompat saat teks kolaborator masuk) */
function caretOff() {
	const s = getSelection();
	if (!s.rangeCount || !ed.contains(s.anchorNode)) return null;
	let p = s.anchorNode;
	while (p.parentNode !== ed) p = p.parentNode;
	const r = document.createRange();
	r.selectNodeContents(p);
	r.setEnd(s.anchorNode, s.anchorOffset);
	let off = r.toString().length;
	for (const q of ed.children) {
		if (q === p) break;
		off += q.textContent.length + 1;
	}
	return off;
}
function setCaret(off) {
	let o = off;
	for (const p of ed.children) {
		const n = p.textContent.length;
		if (o <= n) {
			const r = document.createRange(),
				t = p.firstChild;
			t && t.nodeType === 3 ? r.setStart(t, o) : r.setStart(p, 0);
			r.collapse(true);
			const s = getSelection();
			s.removeAllRanges();
			s.addRange(r);
			return;
		}
		o -= n + 1;
	}
}
ytext.observe((e, tr) => {
	if (tr.origin === "local") return;
	if (tr.origin === um) {
		// undo/redo: taruh kursor di lokasi perubahan
		let pos = 0,
			end = 0;
		for (const d of e.delta) {
			if (d.retain) {
				pos += d.retain;
				if (d.attributes) end = pos;
			} else if (d.insert) {
				pos += d.insert.length;
				end = pos;
			} else if (d.delete) end = pos;
		}
		render();
		ed.focus();
		setCaret(end);
		return;
	}
	let off = caretOff();
	if (off !== null) {
		let pos = 0,
			n = off;
		for (const d of e.delta) {
			if (d.retain) pos += d.retain;
			else if (d.insert) {
				if (pos <= n) n += d.insert.length;
				pos += d.insert.length;
			} else if (d.delete) {
				if (pos < n) n -= Math.min(d.delete, n - pos);
			}
		}
		off = n;
	}
	render();
	if (off !== null) setCaret(off);
});

/* Enter = paragraf baru; paste = teks polos */
function split() {
	const s = getSelection(),
		r = s.getRangeAt(0);
	r.deleteContents();
	let p = r.startContainer;
	while (p.parentNode !== ed) p = p.parentNode;
	const tail = document.createRange();
	tail.setStart(r.startContainer, r.startOffset);
	tail.setEnd(p, p.childNodes.length);
	const rest = tail.toString();
	tail.deleteContents();
	if (!p.textContent) p.innerHTML = "<br>";
	const np = mk(rest);
	p.after(np);
	if (!p.textContent && rest && p.dataset.k) {
		np.dataset.k = p.dataset.k; // Enter di awal baris: jenis ikut teksnya
		delete p.dataset.k;
	}
	setCaret(0);
	const q = document.createRange();
	q.setStart(
		np.firstChild && np.firstChild.nodeType === 3 ? np.firstChild : np,
		0,
	);
	q.collapse(true);
	s.removeAllRanges();
	s.addRange(q);
}
ed.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.isComposing) {
		e.preventDefault();
		split();
		onInput();
	}
});
ed.addEventListener("paste", (e) => {
	e.preventDefault();
	const parts = (e.clipboardData.getData("text/plain") || "")
		.replace(/\r/g, "")
		.split("\n");
	parts.forEach((t, i) => {
		if (i) split();
		if (t) document.execCommand("insertText", false, t);
	});
	onInput();
});
[$("#cont"), $("#max")].forEach((el) => el.addEventListener("input", restyle));

/* ---------- Aksi ---------- */
$("#share").onclick = async (e) => {
	try {
		await navigator.clipboard.writeText(location.href);
		$("#slab").textContent = "Tersalin ✓";
	} catch {
		prompt("Salin tautan ini:", location.href);
	}
	setTimeout(() => ($("#slab").textContent = "Tautan"), 1800);
};
$("#prt").onclick = () => print();
$("#exp").onclick = () => {
	const L = lines(),
		A = analyze(L, kinds()),
		E = L.slice();
	for (let pass = 0; pass < 4; pass++) {
		// simbol Fountain hanya ditambahkan di file ekspor, dan hanya bila tebakan otomatis akan salah
		const G = analyze(E);
		let ch = false;
		A.forEach((a, i) => {
			const p = PRE[a.kind];
			if (
				a.kind !== "blank" &&
				G[i].kind !== a.kind &&
				p &&
				!E[i].startsWith(p)
			) {
				E[i] = p + E[i];
				ch = true;
			}
		});
		if (!ch) break;
	}
	let out = "";
	E.forEach((t, i) => {
		const k = A[i].kind;
		if (k === "blank") return;
		const pk = i ? A[i - 1].kind : "";
		const glue =
			(pk === "character" || pk === "paren") &&
			(k === "dialogue" || k === "paren");
		out += (out && !glue ? "\n\n" : out ? "\n" : "") + t;
	});
	const a = document.createElement("a");
	a.href = URL.createObjectURL(
		new Blob([out + "\n"], { type: "text/plain" }),
	);
	a.download = "naskah.fountain";
	a.click();
	URL.revokeObjectURL(a.href);
};

/* ---------- UI dinamis: chip elemen, navigator adegan, mode fokus, tema ---------- */
const B = document.body,
	root = document.documentElement,
	chip = $("#chip"),
	nav = $("#nav"),
	hdr = $("header");
const KL = {
	scene: "Judul adegan",
	action: "Aksi",
	character: "Karakter",
	dialogue: "Dialog",
	paren: "Parenthetical",
	transition: "Transisi",
	blank: "Baris kosong",
};
const esc = (s) =>
	s.replace(
		/[&<>"]/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
			})[c],
	);
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches
	? "auto"
	: "smooth";
let navKey = "";
function renderNav(L, A) {
	const items = [];
	L.forEach((t, i) => {
		if (A[i].kind === "scene") items.push([i, t]);
	});
	const key = JSON.stringify(items);
	if (key === navKey) return;
	navKey = key;
	nav.innerHTML = items.length
		? items
				.map(
					([i, t], n) =>
						`<button data-i="${i}"><b>${n + 1}</b>${esc(
							t
								.replace(/^\./, "")
								.replace(/^\d+[A-Za-z]?[.)]?\s+/, "")
								.trim(),
						)}</button>`,
				)
				.join("")
		: "<p>Judul adegan muncul di sini begitu kamu menulis INT. atau EXT.</p>";
}
function track() {
	const s = getSelection();
	if (!s.rangeCount || !ed.contains(s.anchorNode)) return;
	let p = s.anchorNode;
	while (p && p.parentNode !== ed) p = p.parentNode;
	if (!p) return;
	if (curEl && curEl !== p) curEl.classList.remove("cur");
	curEl = p;
	p.classList.add("cur");
	let q = s.focusNode;
	while (q && q.parentNode !== ed) q = q.parentNode;
	const kids = [...ed.children],
		ia = kids.indexOf(p),
		ib = q ? kids.indexOf(q) : ia;
	selIdx = [Math.min(ia, ib), Math.max(ia, ib)];
	const kk = p.className.split(" ")[0];
	kindSel.value = kk === "blank" ? "action" : kk;
	document
		.querySelectorAll("#kinds .kind")
		.forEach((b) =>
			b.setAttribute(
				"aria-pressed",
				String(b.dataset.k === kindSel.value),
			),
		);
	chip.textContent =
		KL[p.className.split(" ")[0]] +
		(p.hasAttribute("data-cont") ? " · CONT'D" : "");
	chip.style.transform = `translateY(${p.offsetTop - 4.8}px)`;
	chip.style.height = ` ${p.offsetHeight + 9}px`;
	chip.hidden = false;
	const i = [...ed.children].indexOf(p);
	let act = null;
	nav.querySelectorAll("button").forEach((b) => {
		b.removeAttribute("data-active");
		if (+b.dataset.i <= i) act = b;
	});
	if (act) act.setAttribute("data-active", "");
	if (B.classList.contains("focus") && document.activeElement === ed)
		getComputedStyle(mainEl).overflowY === "auto"
			? mainEl.scrollTo({
					top:
						p.getBoundingClientRect().top -
						mainEl.getBoundingClientRect().top +
						mainEl.scrollTop -
						mainEl.clientHeight * 0.42,
					behavior: calm,
				})
			: scrollTo({
					top:
						p.getBoundingClientRect().top +
						scrollY -
						innerHeight * 0.42,
					behavior: calm,
				});
}
nav.onclick = (e) => {
	const b = e.target.closest("button");
	if (!b) return;
	const n = +b.dataset.i;
	let o = 0;
	for (let k = 0; k < n; k++) o += ed.children[k].textContent.length + 1;
	ed.focus();
	setCaret(o);
	ed.children[n].scrollIntoView({
		behavior: calm,
		block: "center",
	});
	if (innerWidth <= 1100) B.classList.remove("nav");
};
const tog = (id, el, cls, key, def) => {
	const b = $(id),
		set = (v) => {
			el.classList.toggle(cls, v);
			b.setAttribute("aria-pressed", v);
		};
	const saved = ls.get(key);
	set(saved === null ? def : saved === "1");
	b.onclick = () => {
		const v = !el.classList.contains(cls);
		set(v);
		ls.set(key, v ? "1" : "0");
		track();
	};
};
tog("#bnav", B, "nav", "naskah:nav", innerWidth > 1100);
tog("#bfocus", B, "focus", "naskah:focus", false);
tog("#btheme", root, "dark", "naskah:dark", false);
const hh = () => root.style.setProperty("--hh", hdr.offsetHeight + "px");
hh();
addEventListener("resize", hh);
document.addEventListener("selectionchange", track);
ed.addEventListener("input", () => B.classList.add("typing"));
addEventListener("mousemove", () => B.classList.remove("typing"));

/* ---------- Impor .txt: baca struktur (nomor adegan, indentasi), render ulang ---------- */
function parseScript(raw) {
	const src = raw
		.replace(/^\uFEFF/, "")
		.replace(/\r\n?/g, "\n")
		.replace(/\t/g, "    ")
		.split("\n");
	const want = [];
	let prev = "blank";
	for (const line of src) {
		const s = line.trim(),
			ind = line.length - line.trimStart().length;
		if (!s) {
			prev = "blank";
			continue;
		}
		let k,
			t = s;
		if (SCENE.test(s))
			k = "scene"; // nomor adegan di file dipertahankan
		else if (TRANS.test(s)) k = "transition";
		else if (prev === "character" || prev === "paren")
			k = /^\(/.test(s) ? "paren" : "dialogue";
		else if (prev === "dialogue" && ind > 0 && !/^\(.*\)$/.test(s)) {
			want[want.length - 1].t += " " + s;
			continue;
		} else if (prev === "dialogue" && ind > 0) k = "paren";
		else if (ind >= 8 && caps(s)) k = "character";
		else
			k =
				caps(s) && s.length < 45 && !/[.!?:\]]$/.test(s)
					? "character"
					: "action";
		want.push({ k, t });
		prev = k;
	}
	return want;
}
function importText(raw) {
	const want = parseScript(raw),
		L = want.map((w) => w.t),
		K = want.map(() => null);
	for (let pass = 0; pass < 4; pass++) {
		// jenis eksplisit hanya untuk baris yang tebakan editornya beda dari struktur file
		const A = analyze(L, K);
		let ch = false;
		A.forEach((a, i) => {
			if (a.kind !== want[i].k) {
				K[i] = want[i].k;
				ch = true;
			}
		});
		if (!ch) break;
	}
	return { L, K };
}
const dlg = $("#dlg"),
	flash = (m) => {
		$("#sync").textContent = m;
	};
const ask = () =>
	new Promise((r) => {
		dlg.returnValue = "cancel";
		dlg.addEventListener("close", () => r(dlg.returnValue), {
			once: true,
		});
		dlg.showModal();
	});
async function doImport(file) {
	if (!file) return;
	const imp = importText(await file.text());
	if (!imp.L.some((t) => t.trim())) {
		flash("File kosong, tidak ada yang diimpor");
		return;
	}
	let mode = "replace";
	if (ytext.toString().trim()) {
		mode = await ask();
		if (mode === "cancel") return;
	}
	um.stopCapturing();
	writeLines(imp.L, imp.K, mode);
	mainEl.scrollTo({ top: 0 });
	scrollTo({ top: 0 });
	flash(
		`Impor selesai: ${analyze(imp.L, imp.K).filter((a) => a.kind === "scene").length} adegan`,
	);
}
$("#imp").onclick = () => $("#file").click();
$("#file").onchange = async (e) => {
	await doImport(e.target.files[0]);
	e.target.value = "";
};
const hasFiles = (e) =>
	e.dataTransfer && [...e.dataTransfer.types].includes("Files");
let dc = 0;
addEventListener("dragenter", (e) => {
	if (hasFiles(e)) {
		dc++;
		B.classList.add("drop");
	}
});
addEventListener("dragleave", (e) => {
	if (hasFiles(e) && --dc <= 0) {
		dc = 0;
		B.classList.remove("drop");
	}
});
addEventListener("dragover", (e) => {
	if (hasFiles(e)) e.preventDefault();
});
addEventListener("drop", (e) => {
	if (hasFiles(e)) {
		e.preventDefault();
		dc = 0;
		B.classList.remove("drop");
		doImport(e.dataTransfer.files[0]);
	}
});

/* ---------- Dropdown format baris: ubah jenis + format teks otomatis ---------- */
const kindSel = $("#kind");
let selIdx = [0, 0];
const PRE = {
	scene: ".",
	action: "!",
	character: "@",
	transition: ">",
};
const KN = {
	scene: "Judul adegan",
	action: "Aksi",
	character: "Karakter",
	dialogue: "Dialog",
	paren: "Parenthetical",
	transition: "Transisi",
	auto: "Otomatis",
};
const sentence = (t) => (caps(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t);
function fmt(t, k) {
	const x = t.replace(/^\s*[.!@>](?![.!@>])\s?/, "").trim();
	const bare = x.replace(/^\((.*)\)$/, "$1").trim();
	if (k === "scene") {
		const u = bare.toUpperCase();
		return SCENE.test(u) ? u : "INT. " + u;
	}
	if (k === "character")
		return bare.toUpperCase().replace(/[\s.!?:,;\-–]+$/, "");
	if (k === "transition") {
		const u = bare.toUpperCase();
		return /\bTO$/.test(u) ? u + ":" : u;
	}
	if (k === "dialogue") return sentence(bare);
	if (k === "paren") return "(" + bare + ")";
	return x;
}
function applyKind(k) {
	let [a, b] = selIdx;
	const L = lines(),
		K = kinds();
	if (a >= L.length) return;
	b = Math.min(b, L.length - 1);
	if ((k === "dialogue" || k === "paren") && b > a) {
		const j = L.slice(a, b + 1)
			.map((x) => fmt(x, "auto"))
			.join(" ");
		L.splice(a, b - a + 1, j);
		K.splice(a, b - a + 1, null);
		b = a;
	}
	for (let i = a; i <= b; i++) {
		L[i] = fmt(L[i], k);
		K[i] = k === "auto" ? null : k; // jenis disimpan sebagai atribut, bukan simbol
	}
	let sel = null;
	if (k === "dialogue") {
		const A = analyze(L, K),
			pk = a > 0 ? A[a - 1].kind : "";
		if (pk !== "character" && pk !== "paren" && pk !== "dialogue") {
			L.splice(a, 0, "NAMA");
			K.splice(a, 0, "character");
			sel = a;
			b = a + 1;
		} // dialog butuh karakter di atasnya
	}
	um.stopCapturing();
	ed.replaceChildren(...rows(L, K));
	restyle();
	push();
	um.stopCapturing();
	ed.focus();
	const p = ed.children[sel !== null ? sel : b],
		r = document.createRange();
	r.selectNodeContents(p);
	if (sel === null) r.collapse(false);
	const s = getSelection();
	s.removeAllRanges();
	s.addRange(r);
	track();
	flash(
		"Format: " + KN[k] + (sel !== null ? " (ketik nama karakternya)" : ""),
	);
}
kindSel.onchange = () => applyKind(kindSel.value);
ed.addEventListener("keydown", (e) => {
	if (e.altKey && /^Digit[0-6]$/.test(e.code)) {
		e.preventDefault();
		applyKind(
			[
				"auto",
				"scene",
				"action",
				"character",
				"dialogue",
				"paren",
				"transition",
			][+e.code.slice(5)],
		);
	}
});

/* ---------- Urungkan / Ulangi (maks. 30 langkah) ---------- */
const syncUR = () => {
	$("#undo").disabled = !um.undoStack.length;
	$("#redo").disabled = !um.redoStack.length;
	$("#undo").title =
		`Urungkan (Ctrl+Z) · ${um.undoStack.length}/${MAX_UNDO} langkah`;
};
um.on("stack-item-added", () => {
	while (um.undoStack.length > MAX_UNDO) um.undoStack.shift();
	syncUR();
});
um.on("stack-item-popped", syncUR);
um.on("stack-cleared", syncUR);
function undo() {
	um.stopCapturing();
	if (um.undoStack.length) {
		um.undo();
		flash(`Diurungkan · sisa ${um.undoStack.length} langkah`);
	} else flash("Tidak ada lagi yang bisa diurungkan");
	um.stopCapturing();
}
function redo() {
	um.stopCapturing();
	if (um.redoStack.length) {
		um.redo();
		flash("Diulangi");
	} else flash("Tidak ada yang bisa diulangi");
	um.stopCapturing();
}
$("#undo").onclick = () => {
	undo();
	ed.focus();
};
$("#redo").onclick = () => {
	redo();
	ed.focus();
};
document.addEventListener("keydown", (e) => {
	if (
		!(e.ctrlKey || e.metaKey) ||
		e.altKey ||
		e.target.closest("input,textarea")
	)
		return;
	const k = e.key.toLowerCase();
	if (k === "z" && !e.shiftKey) {
		e.preventDefault();
		undo();
	} else if (k === "y" || (k === "z" && e.shiftKey)) {
		e.preventDefault();
		redo();
	}
});
ed.addEventListener("beforeinput", (e) => {
	// undo/redo bawaan browser (menu, papan ketik mobile)
	if (e.inputType === "historyUndo") {
		e.preventDefault();
		undo();
	} else if (e.inputType === "historyRedo") {
		e.preventDefault();
		redo();
	}
});

// Ctrl+S / Cmd+S dimatikan: cegah dialog "Simpan halaman" bawaan browser
document.addEventListener("keydown", (e) => {
	if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s")
		e.preventDefault();
});

/* ---------- Naskah baru & daftar naskah di perangkat ---------- */
const LK = "naskah:list",
	ndlg = $("#ndlg");
let saveT,
	deleting = false;
const readList = () => {
	try {
		return JSON.parse(ls.get(LK) || "[]");
	} catch {
		return [];
	}
};
function saveMeta() {
	clearTimeout(saveT);
	saveT = setTimeout(() => {
		if (deleting) return;
		const first = ytext
			.toString()
			.split("\n")
			.map((x) => x.trim().replace(/^[.!@>](?![.!@>])/, ""))
			.find(Boolean);
		const old = readList(),
			ex = old.find((x) => x.room === room),
			custom = String(ymeta.get("title") || "").trim(),
			title = custom || (first ? first.slice(0, 48) : ex && ex.title);
		const l = old.filter((x) => x.room !== room);
		if (title) l.unshift({ room, title });
		ls.set(LK, JSON.stringify(l.slice(0, 200)));
		renderProj();
		const ct = custom || (first && first.slice(0, 48));
		if (ct && cloudApi) cloudApi.title(ct);
	}, 800);
}
/* nama script manual: tersimpan di dokumen Yjs, menggantikan judul otomatis */
const snameEl = $("#sname");
snameEl.oninput = () => {
	doc.transact(
		() => ymeta.set("title", snameEl.value.trim().slice(0, 60)),
		"local",
	);
	saveMeta();
};
ymeta.observe(() => {
	if (document.activeElement !== snameEl)
		snameEl.value = ymeta.get("title") || "";
	saveMeta();
});
snameEl.value = ymeta.get("title") || "";
const go = (r) => {
	ls.set("naskah:last", r);
	location.hash = r;
}; // hashchange memuat ulang halaman
$("#new").onclick = async () => {
	let l = readList().filter((x) => x.room !== room);
	if (cloudApi) {
		const c = await cloudApi.list(),
			ids = new Set(c.map((x) => x.id));
		l = [
			...c
				.filter((x) => x.id !== room)
				.map((x) => ({
					room: x.id,
					title: x.title || "Tanpa judul",
				})),
			...l.filter((x) => !ids.has(x.room)),
		];
	}
	$("#recent").innerHTML = l.length
		? "<small>Atau buka naskah lain:</small>" +
			l
				.slice(0, 8)
				.map(
					(x) =>
						`<button type="button" data-r="${esc(x.room)}">${esc(x.title)}</button>`,
				)
				.join("")
		: "";
	ndlg.returnValue = "cancel";
	ndlg.showModal();
};
$("#recent").onclick = (e) => {
	const b = e.target.closest("button[data-r]");
	if (b) {
		ndlg.close("cancel");
		go(b.dataset.r);
	}
};
ndlg.addEventListener("close", () => {
	if (ndlg.returnValue === "new") newScript(curProj());
});
addEventListener("hashchange", () => {
	const r = location.hash.slice(1);
	if (r && r !== room) {
		ls.set("naskah:last", r);
		location.reload();
	}
});

/* ---------- Supabase: akun + simpan ke database (opsional, lihat config.js) ---------- */
let cloudApi = null,
	delCloud = null,
	srvApi = null,
	lastTitle = "";
const CFG = window.NASKAH_CONFIG || {};
const b64 = (u) => {
	let s = "";
	for (let i = 0; i < u.length; i += 8192)
		s += String.fromCharCode(...u.subarray(i, i + 8192));
	return btoa(s);
};
const unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
async function initCloud() {
	const btn = document.querySelectorAll("#login"),
		cl = $("#cl"),
		status = (m) => {
			cl.textContent = m;
		};
	if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) {
		status("mode lokal");
		return;
	}
	const { createClient } =
		await import("https://esm.sh/@supabase/supabase-js@2.45.4");
	const sb = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
		auth: { flowType: "pkce", detectSessionInUrl: true },
	});
	let user = null,
		attached = null,
		q = [],
		ft = null,
		username = "Masuk";
	// alamat server signaling disimpan di naskah / proyek (berubah tiap ngrok dijalankan ulang)
	const loadSig = async () => {
		if (!attached) return;
		const { data: r, error } = await sb
			.from("scripts")
			.select("signaling,project_id,owner")
			.eq("id", room)
			.maybeSingle();
		if (error || !r) return; // kolom belum ada / naskah belum di akun: biarkan cache
		sigSrc.script = r.signaling || "";
		sigSrc.sowner = r.owner;
		sigSrc.pid = r.project_id || null;
		sigSrc.project = "";
		sigSrc.pname = "";
		sigSrc.powner = null;
		if (r.project_id) {
			const { data: p } = await sb
				.from("projects")
				.select("name,owner,signaling")
				.eq("id", r.project_id)
				.maybeSingle();
			if (p) {
				sigSrc.project = p.signaling || "";
				sigSrc.pname = p.name || "";
				sigSrc.powner = p.owner;
			}
		}
		applySig();
	};
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) loadSig();
	});
	addEventListener("online", loadSig);
	srvApi = {
		user: () => user,
		refresh: loadSig,
		save: (scope, t) =>
			scope === "project"
				? sb.rpc("set_project_signaling", {
						p_pid: sigSrc.pid,
						p_urls: t,
					})
				: sb.rpc("set_script_signaling", {
						p_sid: room,
						p_urls: t,
					}),
	};
	btn.forEach((a) => {
		a.hidden = false;

		a.onclick = async () => {
			if (!user) {
				$("#amsg").textContent = "";
				$("#adlg").showModal();
				return;
			}
			if (
				confirm("Keluar dari akun? Naskah di perangkat ini tetap ada.")
			) {
				await sb.auth.signOut();
				location.reload();
			}
		};

		a.textContent = username;
	});
	delCloud = async (id) => {
		const { data, error } = await sb
			.from("scripts")
			.delete()
			.eq("id", id)
			.select("id");
		if (error) throw error;
		if (data && data.length) return "ok";
		const { data: ex } = await sb
			.from("scripts")
			.select("id")
			.eq("id", id)
			.maybeSingle();
		return ex ? "notowner" : "ok"; // tidak ada di cloud = hanya ada di perangkat ini
	};
	status("belum masuk · tersimpan di browser ini");

	async function flush() {
		if (!q.length) return;
		const batch = q;
		q = [];
		const { error } = await sb.from("script_updates").insert({
			script_id: room,
			client: doc.clientID,
			data: b64(Y.mergeUpdates(batch)),
		});
		if (error) {
			q = batch.concat(q);
			status("☁ belum tersimpan, mencoba lagi…");
			ft = setTimeout(flush, 5000);
		} else if (!q.length) status("☁ tersimpan di akun");
	}
	async function attach(u) {
		if (attached === u.id) return;
		attached = u.id;
		status("☁ menghubungkan…");
		await idb.whenSynced;
		let { data: row, error } = await sb
			.from("scripts")
			.select("id,state,state_upto,owner,project_id")
			.eq("id", room)
			.maybeSingle();
		if (error) {
			status("☁ gagal: " + error.message);
			attached = null;
			return;
		}
		if (!row) {
			await projApi.syncUp();
			const ins = await sb
				.from("scripts")
				.insert({
					id: room,
					project_id: readProj().map[room] || null,
				})
				.select("id,state,state_upto,owner,project_id")
				.single();
			if (ins.error) {
				attached = null;
				status(
					ins.error.code === "23505"
						? "☁ naskah ini milik orang lain: minta pemiliknya mengundang emailmu"
						: "☁ gagal: " + ins.error.message,
				);
				return;
			}
			row = ins.data;
		}
		{
			const lp = readProj().map[room] || null;
			if (row.owner !== u.id || !lp) {
				// pemilik proyek/koleganya: data cloud menang
				if (row.project_id && row.project_id !== lp) {
					const P = readProj();
					P.map[room] = row.project_id;
					writeProj(P);
					renderProj();
				}
			} else if (lp !== row.project_id)
				await sb
					.from("scripts")
					.update({ project_id: lp })
					.eq("id", room);
		}
		// muat snapshot + log update dari database
		const cdoc = new Y.Doc();
		let last = row.state_upto,
			count = 0;
		if (row.state) Y.applyUpdate(cdoc, unb64(row.state));
		for (;;) {
			const { data: ups, error: e2 } = await sb
				.from("script_updates")
				.select("id,data")
				.eq("script_id", room)
				.gt("id", last)
				.order("id")
				.limit(1000);
			if (e2) {
				status("☁ gagal memuat: " + e2.message);
				attached = null;
				return;
			}
			ups.forEach((r) => {
				Y.applyUpdate(cdoc, unb64(r.data));
				last = r.id;
				count++;
			});
			if (ups.length < 1000) break;
		}
		Y.applyUpdate(doc, Y.encodeStateAsUpdate(cdoc), "cloud");
		migrateLegacy();
		// unggah apa pun yang baru ada di perangkat ini
		const diff = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(cdoc));
		if (diff.length > 2)
			await sb.from("script_updates").insert({
				script_id: room,
				client: doc.clientID,
				data: b64(diff),
			});
		if (count > 150)
			sb.rpc("compact_script", {
				p_sid: room,
				p_snapshot: b64(Y.encodeStateAsUpdate(cdoc)),
				p_upto: last,
			}).then(() => {});
		doc.on("update", (upd, origin) => {
			if (origin === "cloud") return;
			q.push(upd);
			status("☁ menyimpan…");
			clearTimeout(ft);
			ft = setTimeout(flush, 1500);
		});
		const ch = sb.channel("naskah-" + room, {
			config: { presence: { key: String(doc.clientID) } },
		});
		presenceTrack = () => ch.track(me());
		ch.on(
			"postgres_changes",
			{
				event: "INSERT",
				schema: "public",
				table: "script_updates",
				filter: `script_id=eq.${room}`,
			},
			(p) => {
				if (+p.new.client !== doc.clientID)
					Y.applyUpdate(doc, unb64(p.new.data), "cloud");
			},
		)
			.on(
				"postgres_changes",
				{
					event: "UPDATE",
					schema: "public",
					table: "scripts",
					filter: `id=eq.${room}`,
				},
				(p) => {
					// updated_at ikut berubah tiap edit, jadi muat ulang hanya bila alamat/proyek berganti
					const n = p.new || {};
					if (
						(n.signaling || "") !== sigSrc.script ||
						(n.project_id || null) !== sigSrc.pid
					)
						loadSig();
				},
			)
			.on(
				"postgres_changes",
				{
					event: "UPDATE",
					schema: "public",
					table: "projects",
				},
				(p) => {
					const n = p.new || {};
					if (
						n.id === sigSrc.pid &&
						(n.signaling || "") !== sigSrc.project
					)
						loadSig();
				},
			)
			.on("presence", { event: "sync" }, () =>
				showPeers(Object.values(ch.presenceState()).flat()),
			)
			.subscribe((st) => {
				if (st === "SUBSCRIBED") presenceTrack();
			});
		const owner = row.owner === u.id;
		cloudOwner = owner;
		syncInviteBtn();
		cloudApi = {
			title: async (t) => {
				if (t !== lastTitle) {
					lastTitle = t;
					await sb.rpc("set_title", {
						p_sid: room,
						p_title: t,
					});
				}
			},
			setProject: async (pid) => {
				if (owner)
					await sb
						.from("scripts")
						.update({ project_id: pid })
						.eq("id", room);
			},
			list: async () => {
				const { data } = await sb
					.from("scripts")
					.select("id,title")
					.order("updated_at", { ascending: false })
					.limit(20);
				return data || [];
			},
		};
		$("#invite").onclick = async () => {
			const email = (
				prompt(
					"Email orang yang diundang (harus sudah punya akun Naskah):",
				) || ""
			).trim();
			if (!email) return;
			const { error: e } = await sb.rpc("invite_member", {
				p_sid: room,
				p_email: email,
			});
			alert(
				e ? inviteErr(e) : `${email} sekarang bisa membuka naskah ini.`,
			);
		};
		status("☁ tersimpan di akun");
		loadSig();
	}
	sb.auth.onAuthStateChange((_ev, session) => {
		user = (session && session.user) || null;
		projApi = user ? makeProjApi(sb, user) : null;
		username = user ? `${user.email} · Keluar` : "Masuk";
		if (user)
			setTimeout(() => {
				refreshProj();
				attach(user).catch((e) => status("☁ " + e.message));
			}, 0);
	});
	$("#email").onkeydown = (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			$("#asend").click();
		}
	};
	$("#asend").onclick = async () => {
		const email = $("#email").value.trim();
		if (!email) return;
		const { error } = await sb.auth.signInWithOtp({
			email,
			options: {
				emailRedirectTo: location.origin + location.pathname,
			},
		});
		$("#amsg").textContent = error
			? /rate limit|429/i.test(error.message + error.status)
				? "Batas pengiriman email Supabase tercapai (bawaan hanya 2 email per jam untuk seluruh proyek). Tunggu sekitar 1 jam, atau pasang SMTP sendiri di dashboard Supabase (lihat README)."
				: error.message
			: "Tautan dikirim. Buka emailmu di browser ini, lalu klik tautannya.";
	};
}

/* ---------- Saran otomatis: judul adegan & karakter ---------- */
const PREFIXES = ["INT. ", "EXT. ", "INT./EXT. ", "EST. "];
const TIMES = [
	"DAY",
	"NIGHT",
	"MORNING",
	"AFTERNOON",
	"EVENING",
	"DAWN",
	"DUSK",
	"LATER",
	"CONTINUOUS",
	"MOMENTS LATER",
	"PAGI",
	"SIANG",
	"SORE",
	"MALAM",
	"SUBUH",
	"KEMUDIAN",
];
const HEAD =
	/^\.?(?:\d+[A-Za-z]?[.)]?\s+)?(INT\.\/EXT\.|INT\/EXT\.?|INT\.|EXT\.|EST\.|I\/E\.?)\s(.*)$/i;
const EXTS = ["(V.O.)", "(O.S.)", "(O.C.)", "(CONT'D)"];
function itemsFor(L, idx) {
	const t = L[idx],
		A = analyze(L, kinds()),
		out = [],
		add = (label, value) => {
			if (!out.some((o) => o.value === value)) out.push({ label, value });
		};
	const ek = kinds()[idx];
	if (ek && ek !== "character" && ek !== "scene") return out;
	const lo = t.toLowerCase();
	const nm = t.match(/^(\d+[A-Za-z]?[.)]?\s+)?([\s\S]*)$/),
		num = nm[1] || "",
		rest = nm[2].toLowerCase();
	if (rest.length >= 2 && (num || !/^[.!@>]/.test(t))) {
		PREFIXES.forEach((o) => {
			if (o.toLowerCase().startsWith(rest) && o.toLowerCase() !== rest)
				add(o.trim(), num + o);
		});
		if (out.length) return out;
	}
	const m = t.match(HEAD);
	if (m) {
		// judul adegan: lokasi lalu waktu
		const raw = m[2],
			pre = t.slice(0, t.length - raw.length),
			body = raw.replace(/^\s+/, "").toUpperCase(),
			locs = [],
			used = [];
		for (let i = L.length - 1; i >= 0; i--) {
			if (i === idx) continue;
			const h = L[i].match(HEAD);
			if (!h) continue;
			const segs = h[2]
				.toUpperCase()
				.trim()
				.split(/\s+-\s+/);
			if (segs.length > 1 && TIMES.includes(segs[segs.length - 1])) {
				const tm = segs.pop();
				if (!used.includes(tm)) used.push(tm);
			}
			const loc = segs.join(" - ");
			if (loc && !locs.includes(loc)) locs.push(loc);
		}
		const di = body.lastIndexOf(" - ");
		if (di < 0) {
			const ty = body.trim();
			locs.filter((c) => c !== ty && c.startsWith(ty))
				.slice(0, 6)
				.forEach((c) => add(c, pre + c + " - "));
			if (!out.length && ty.length >= 2)
				locs.filter((c) => c !== ty && c.includes(ty))
					.slice(0, 6)
					.forEach((c) => add(c, pre + c + " - "));
		} else {
			const left = body.slice(0, di),
				ty = body.slice(di + 3).trim(),
				whole = left + " - " + ty;
			locs.filter((c) => c !== whole && c.startsWith(whole))
				.slice(0, 4)
				.forEach((c) => add(c, pre + c + " - "));
			[...used, ...TIMES.filter((x) => !used.includes(x))]
				.filter((x) => x !== ty && x.startsWith(ty))
				.slice(0, 5)
				.forEach((x) => add(x, pre + left + " - " + x));
		}
		return out.slice(0, 7);
	}
	if (/^[.!>]/.test(t)) return out;
	const at = t.startsWith("@") ? "@" : "",
		ty = t.slice(at.length),
		pk = idx > 0 ? A[idx - 1].kind : "";
	if (pk === "character" || pk === "paren") return out; // baris ini dialog, bukan karakter
	const names = [];
	for (let i = L.length - 1; i >= 0; i--) {
		if (i === idx || A[i].kind !== "character") continue;
		const n = speaker(L[i]);
		if (n && !names.includes(n)) names.push(n);
	}
	const em = ty.match(/^(.*?)\s*\(([A-Za-z.' ]*)$/);
	if (em) {
		const nm = em[1].trim().toUpperCase(),
			q = ("(" + em[2]).toLowerCase();
		if (names.includes(nm))
			EXTS.forEach((x) => {
				if (x.toLowerCase().startsWith(q) && x.toLowerCase() !== q)
					add(x, at + nm + " " + x);
			});
		return out;
	}
	if (ty.length >= 2 && !/[().!?:]/.test(ty)) {
		const U = ty.toUpperCase();
		names
			.filter((n) => n.startsWith(U) && n !== U)
			.slice(0, 6)
			.forEach((n) => add(n, at + n));
	}
	return out;
}
const sug = $("#sug");
let S = null;
function hideSug() {
	S = null;
	sug.hidden = true;
}
function drawSug() {
	sug.innerHTML =
		S.items
			.map(
				(x, n) =>
					`<button type="button" role="option" data-n="${n}"${n === S.i ? ' aria-selected="true"' : ""}>${esc(x.label)}</button>`,
			)
			.join("") + "<small>Tab pilih · ↑↓ geser · Esc tutup</small>";
	const s = getSelection();
	let r = s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : null;
	if (!r || (!r.height && !r.top)) r = S.p.getBoundingClientRect();
	sug.hidden = false;
	sug.style.left =
		Math.max(8, Math.min(r.left, innerWidth - sug.offsetWidth - 8)) + "px";
	sug.style.top = r.bottom + 6 + "px";
}
function suggest() {
	const s = getSelection();
	if (!s.rangeCount || !s.isCollapsed || !ed.contains(s.anchorNode))
		return hideSug();
	let p = s.anchorNode;
	while (p.parentNode !== ed) p = p.parentNode;
	const r = document.createRange();
	r.selectNodeContents(p);
	r.setEnd(s.anchorNode, s.anchorOffset);
	if (r.toString().length !== p.textContent.length) return hideSug(); // saran hanya saat kursor di ujung baris
	const L = lines(),
		items = itemsFor(L, [...ed.children].indexOf(p));
	if (!items.length) return hideSug();
	S = { p, items, i: 0, nav: false };
	drawSug();
}
function acceptSug() {
	if (!S) return;
	const { p, items, i } = S;
	hideSug();
	p.textContent = items[i].value;
	const r = document.createRange();
	r.selectNodeContents(p);
	r.collapse(false);
	const s = getSelection();
	s.removeAllRanges();
	s.addRange(r);
	onInput();
}
ed.addEventListener(
	"keydown",
	(e) => {
		if (!S || e.isComposing) return;
		const stop = () => {
			e.preventDefault();
			e.stopImmediatePropagation();
		};
		if (e.key === "Tab") {
			stop();
			acceptSug();
		} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			stop();
			S.i =
				(S.i + (e.key === "ArrowDown" ? 1 : S.items.length - 1)) %
				S.items.length;
			S.nav = true;
			drawSug();
		} else if (e.key === "Enter" && S.nav) {
			stop();
			acceptSug();
		} else if (e.key === "Escape") {
			e.preventDefault();
			hideSug();
		}
	},
	true,
);
sug.addEventListener("mousedown", (e) => e.preventDefault());
sug.addEventListener("click", (e) => {
	const b = e.target.closest("button[data-n]");
	if (b && S) {
		S.i = +b.dataset.n;
		acceptSug();
	}
});
ed.addEventListener("blur", hideSug);
addEventListener(
	"scroll",
	() => {
		if (S) drawSug();
	},
	{ passive: true, capture: true },
);
document.addEventListener("selectionchange", () => {
	if (!S) return;
	const s = getSelection();
	if (
		!s.rangeCount ||
		!s.isCollapsed ||
		!ed.contains(S.p) ||
		!S.p.contains(s.anchorNode)
	)
		return hideSug();
	const r = document.createRange();
	r.selectNodeContents(S.p);
	r.setEnd(s.anchorNode, s.anchorOffset);
	if (r.toString().length !== S.p.textContent.length) hideSug();
});

/* ---------- Proyek: tiap proyek punya id dan beberapa script ---------- */
const PK = "naskah:proj",
	proj = $("#proj");
let projApi = null,
	cloudOwner = false;
const readProj = () => {
	try {
		const p = JSON.parse(ls.get(PK) || "null");
		return p && p.projects ? p : { projects: [], map: {} };
	} catch {
		return { projects: [], map: {} };
	}
};
const writeProj = (p) => ls.set(PK, JSON.stringify(p));
const curProj = () => readProj().map[room] || null;
const syncInviteBtn = () => {
	$("#invite").hidden = !(cloudOwner && !curProj());
};
const inviteErr = (e) =>
	/user_not_found/.test(e.message)
		? "Email itu belum punya akun. Minta dia masuk dulu lewat tombol Masuk, lalu undang lagi."
		: /not_owner/.test(e.message)
			? "Hanya pemilik yang bisa mengundang."
			: e.message;
const addProject = (name) => {
	const P = readProj(),
		id = rnd().slice(0, 6);
	P.projects.push({ id, name });
	writeProj(P);
	if (projApi) projApi.save({ id, name });
	return id;
};
function newScript(pid) {
	const r = rnd(),
		P = readProj();
	if (pid) P.map[r] = pid;
	writeProj(P);
	const L = readList();
	L.unshift({ room: r, title: "Naskah baru" });
	ls.set(LK, JSON.stringify(L.slice(0, 200)));
	go(r);
}
const ICON_TRASH =
	'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
function renderProj() {
	const P = readProj(),
		L = readList(),
		titles = new Map();
	if (!L.some((x) => x.room === room)) titles.set(room, "Naskah ini");
	L.forEach((x) => titles.set(x.room, x.title || "Tanpa judul"));
	const groups = new Map(P.projects.map((p) => [p.id, []])),
		loose = [];
	titles.forEach((t, r) => (groups.get(P.map[r]) || loose).push([r, t]));
	const item = ([r, t]) =>
		`<li class="rw"${r === room ? " data-cur" : ""}><button class="sc" data-r="${esc(r)}"${r === room ? ' aria-current="true"' : ""}>${esc(t)}</button><button class="rm" data-d="${esc(r)}" title="Hapus script" aria-label="Hapus script">${ICON_TRASH}</button></li>`;
	const list = (a) =>
		a.length
			? `<ul>${a.map(item).join("")}</ul>`
			: '<small class="em">Belum ada script</small>';
	const cp = P.map[room] || "";
	const pn = P.projects.find((p) => p.id === cp);
	$("#crumb").textContent = pn ? pn.name : "Tanpa proyek";
	const head = `<h2>Proyek <button data-a="newp">+ Proyek</button></h2><label class="em">Naskah ini ada di proyek<select id="pmove"><option value="">(tanpa proyek)</option>${P.projects.map((p) => `<option value="${esc(p.id)}"${p.id === cp ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>`;
	const body =
		P.projects
			.map((p) => {
				const a = groups.get(p.id);
				const mine = p.mine !== false;
				return `<section><div class="ph"><b>${esc(p.name)}</b><small>#${esc(p.id)} · ${a.length} script${mine ? "" : " · dibagikan"}</small><button data-a="adds" data-p="${esc(p.id)}">+ Script</button>${mine ? `<button data-a="inv" data-p="${esc(p.id)}" title="Undang kolaborator ke proyek ini">Undang</button><button data-a="ren" data-p="${esc(p.id)}" title="Ganti nama">✎</button><button data-a="del" data-p="${esc(p.id)}" title="Hapus proyek" aria-label="Hapus proyek">${ICON_TRASH}</button>` : ""}</div>${list(a)}</section>`;
			})
			.join("") +
		(loose.length
			? `<section><div class="ph"><b>Tanpa proyek</b><small>${loose.length} script</small></div>${list(loose)}</section>`
			: "");
	const st = proj.scrollTop;
	proj.innerHTML = head + body;
	proj.scrollTop = st;
	syncInviteBtn();
}
proj.addEventListener("click", async (e) => {
	const b = e.target.closest("button");
	if (!b) return;
	if (b.dataset.d) {
		deleteScript(b.dataset.d);
		return;
	}
	if (b.dataset.r) {
		if (b.dataset.r !== room) go(b.dataset.r);
		return;
	}
	const a = b.dataset.a,
		pid = b.dataset.p;
	if (a === "newp") {
		const n = (prompt("Nama proyek baru:") || "").trim().slice(0, 40);
		if (n) newScript(addProject(n));
	} else if (a === "adds") newScript(pid);
	else if (a === "inv") {
		if (!projApi) {
			alert(
				"Masuk dulu (tombol Masuk di header) supaya bisa mengundang kolaborator.",
			);
			return;
		}
		const email = (
			prompt(
				"Email kolaborator (harus sudah punya akun Naskah). Dia akan bisa membuka semua script di proyek ini:",
			) || ""
		).trim();
		if (!email) return;
		try {
			await projApi.invite(pid, email);
			alert(`${email} sekarang bisa melihat semua script di proyek ini.`);
		} catch (err) {
			alert(inviteErr(err));
		}
	} else if (a === "ren") {
		const P = readProj(),
			p = P.projects.find((x) => x.id === pid);
		if (!p) return;
		const n = (prompt("Nama proyek:", p.name) || "").trim().slice(0, 40);
		if (n) {
			p.name = n;
			writeProj(P);
			if (projApi) projApi.save(p);
			renderProj();
		}
	} else if (
		a === "del" &&
		confirm(
			"Hapus proyek ini? Script di dalamnya tidak dihapus, hanya dikeluarkan dari proyek.",
		)
	) {
		const P = readProj();
		P.projects = P.projects.filter((x) => x.id !== pid);
		for (const r in P.map) if (P.map[r] === pid) delete P.map[r];
		writeProj(P);
		if (projApi) projApi.remove(pid);
		renderProj();
	}
});
proj.addEventListener("change", (e) => {
	if (e.target.id !== "pmove") return;
	const v = e.target.value,
		P = readProj();
	v ? (P.map[room] = v) : delete P.map[room];
	writeProj(P);
	if (cloudApi) cloudApi.setProject(v || null);
	renderProj();
});
function makeProjApi(sb, user) {
	const syncUp = async () => {
		// unggah proyek milikku yang baru ada di perangkat ini
		const { data } = await sb.from("projects").select("id"),
			have = new Set((data || []).map((x) => x.id));
		const miss = readProj().projects.filter(
			(p) => p.mine !== false && !have.has(p.id),
		);
		if (miss.length)
			await sb
				.from("projects")
				.upsert(miss.map((p) => ({ id: p.id, name: p.name })));
	};
	return {
		uid: user.id,
		syncUp,
		save: async (p) => {
			await sb.from("projects").upsert({ id: p.id, name: p.name });
		},
		remove: async (id) => {
			await sb.from("projects").delete().eq("id", id);
		},
		invite: async (pid, email) => {
			await syncUp();
			const { error } = await sb.rpc("invite_project_member", {
				p_pid: pid,
				p_email: email,
			});
			if (error) throw error;
		},
		overview: async () => {
			const [a, b] = await Promise.all([
				sb.from("projects").select("id,name,owner").order("created_at"),
				sb
					.from("scripts")
					.select("id,title,project_id")
					.order("updated_at", { ascending: false })
					.limit(200),
			]);
			return {
				projects: a.data || [],
				scripts: b.data || [],
			};
		},
	};
}
async function refreshProj() {
	if (!projApi) return;
	try {
		await projApi.syncUp();
		const o = await projApi.overview(),
			P = readProj(),
			L = readList(),
			uid = projApi.uid;
		o.projects.forEach((c) => {
			const x = P.projects.find((p) => p.id === c.id),
				mine = c.owner === uid;
			x
				? ((x.name = c.name), (x.mine = mine))
				: P.projects.push({ id: c.id, name: c.name, mine });
		});
		o.scripts.forEach((c) => {
			if (c.project_id) P.map[c.id] = c.project_id;
			if (!L.some((x) => x.room === c.id))
				L.push({
					room: c.id,
					title: c.title || "Tanpa judul",
				});
		});
		writeProj(P);
		ls.set(LK, JSON.stringify(L.slice(0, 200)));
		renderProj();
	} catch {}
}

renderProj();

/* ---------- Format baris lewat tombol + hapus script (permanen) ---------- */
$("#kinds").addEventListener("mousedown", (e) => e.preventDefault());
$("#kinds").onclick = (e) => {
	const b = e.target.closest(".kind");
	if (!b) return;
	kindSel.value = b.dataset.k;
	applyKind(b.dataset.k);
};
const ddlg = $("#ddlg");
async function deleteScript(id) {
	const t = readList().find((x) => x.room === id);
	$("#dname").textContent = (t && t.title) || "Script ini";
	ddlg.returnValue = "cancel";
	await new Promise((r) => {
		ddlg.addEventListener("close", r, { once: true });
		ddlg.showModal();
	});
	if (ddlg.returnValue !== "del") return;
	if (delCloud) {
		try {
			if ((await delCloud(id)) === "notowner") {
				alert("Hanya pemilik script yang bisa menghapusnya.");
				return;
			}
		} catch (e) {
			flash("Gagal menghapus: " + e.message);
			return;
		}
	}
	if (id === room) deleting = true;
	clearTimeout(saveT);
	ls.set(LK, JSON.stringify(readList().filter((x) => x.room !== id)));
	const P = readProj();
	delete P.map[id];
	writeProj(P);
	try {
		if (id === room) await idb.clearData();
		else indexedDB.deleteDatabase("naskah-" + id);
	} catch {}
	if (id === room) {
		const nx = readList()[0];
		go(nx ? nx.room : rnd());
	} else {
		renderProj();
		flash("Script dihapus");
	}
}
$("#del").onclick = () => deleteScript(room);

/* ---------- Mode presentasi: landscape, hanya baca, sorotan fokus per elemen ----------
			   Lapisan terpisah (#pres) yang membaca naskah saat dibuka (snapshot); #ed tidak disentuh.
			   Satu slide = satu adegan; adegan panjang dipecah ke beberapa slide agar muat di layar. */
{
	const pres = $("#pres"),
		pc = $("#pc"),
		pslide = $("#pslide"),
		ptitle = $("#ptitle"),
		pbar = $("#pbar"),
		pcount = $("#pcount"),
		coarse = matchMedia("(pointer: coarse)");
	const strip = {
		scene: (t) => t.replace(/^\.(?!\.)/, ""),
		character: (t) => t.replace(/^@/, ""),
		transition: (t) => t.replace(/^>\s*/, ""),
		action: (t) => t.replace(/^!/, ""),
	};
	const sceneName = (t) =>
		t
			.replace(/^\./, "")
			.replace(/^\d+[A-Za-z]?[.)]?\s+/, "")
			.trim();
	let units = [],
		slides = [],
		slideOf = [],
		ui = 0,
		si = -1,
		isOpen = false,
		inFs = false,
		idleT = 0,
		raf = 0;

	function pEl(e) {
		const p = document.createElement("p");
		p.className = e.k;
		p.textContent = e.t;
		if (e.cont) p.setAttribute("data-cont", "");
		return p;
	}
	// satu "unit" = satu langkah sorotan: blok dialog (karakter + paren + dialog) atau satu paragraf
	function buildUnits() {
		const L = lines(),
			A = analyze(L, kinds()),
			out = [];
		let g = null,
			n = 0,
			title = "";
		L.forEach((t, i) => {
			const k = A[i].kind;
			if (k === "blank") {
				g = null;
				return;
			}
			const e = {
				k,
				t: strip[k] ? strip[k](t) : t,
				cont: A[i].cont,
			};
			if (!e.t.trim()) {
				g = null;
				return;
			}
			if (k === "scene") {
				n++;
				title = sceneName(t);
			}
			const grp = k === "paren" || k === "dialogue";
			if (grp && g) {
				g.els.push(e);
				return;
			}
			const u = { els: [e], n, title, scene: k === "scene" };
			out.push(u);
			g = k === "character" || grp ? u : null;
		});
		out.forEach((u) => (u.nodes = u.els.map(pEl)));
		return out;
	}
	// ukur ulang ukuran font & pecah unit menjadi slide sesuai tinggi layar
	function layout() {
		pres.classList.toggle(
			"rot",
			innerHeight > innerWidth && coarse.matches,
		);
		const W = pres.clientWidth,
			H = pres.clientHeight,
			fs = Math.max(11, Math.min((W * 0.8) / 36, H / 13, 64)),
			py = H * 0.1,
			px = W * 0.05,
			avail = H - 2 * py,
			st = pres.style;
		st.setProperty("--pfs", fs + "px");
		st.setProperty("--cfs", Math.max(11, Math.min(18, H / 48)) + "px");
		st.setProperty("--py", py + "px");
		st.setProperty("--px", px + "px");
		units.forEach((u) => u.nodes.forEach((x) => x.classList.remove("on")));
		slides = [];
		slideOf = [];
		si = -1;
		let cur = null;
		pc.replaceChildren();
		units.forEach((u, k) => {
			if (u.scene && cur) {
				slides.push(cur);
				cur = null;
				pc.replaceChildren();
			}
			if (!cur) cur = { us: [], n: u.n, title: u.title };
			pc.append(...u.nodes);
			if (cur.us.length && pc.offsetHeight > avail) {
				slides.push(cur);
				cur = { us: [], n: u.n, title: u.title };
				pc.replaceChildren(...u.nodes);
			}
			cur.us.push(k);
			slideOf[k] = slides.length;
		});
		if (cur) slides.push(cur);
		const tot = {},
			seen = {};
		slides.forEach((s) => (tot[s.n] = (tot[s.n] || 0) + 1));
		slides.forEach((s) => {
			const part = (seen[s.n] = (seen[s.n] || 0) + 1);
			s.label = s.n
				? `Adegan ${s.n} · ${s.title}` +
					(tot[s.n] > 1 ? ` (${part}/${tot[s.n]})` : "")
				: "";
		});
		pc.replaceChildren();
	}
	function go(k, quiet) {
		if (!units.length) return;
		k = Math.max(0, Math.min(units.length - 1, k));
		units[ui]?.nodes.forEach((x) => x.classList.remove("on"));
		ui = k;
		const u = units[k],
			s = slideOf[k];
		if (s !== si) {
			si = s;
			pc.replaceChildren(...slides[s].us.flatMap((j) => units[j].nodes));
			ptitle.textContent = slides[s].label;
			ptitle.hidden = !slides[s].label;
			pslide.scrollTop = 0;
			if (!quiet && calm !== "auto")
				pc.animate([{ opacity: 0 }, { opacity: 1 }], {
					duration: 260,
					easing: "ease-out",
				});
		}
		u.nodes.forEach((x) => x.classList.add("on"));
		u.nodes[0].scrollIntoView({
			block: "center",
			behavior: calm,
		});
		pbar.style.width = ((k + 1) / units.length) * 100 + "%";
		pcount.textContent = `${s + 1} / ${slides.length}`;
	}
	function start(at = 0) {
		layout();
		if (!units.length) {
			const p = pEl({
				k: "action",
				t: "Naskah masih kosong. Tulis dulu, lalu mulai presentasi.",
			});
			p.classList.add("on");
			pc.replaceChildren(p);
			ptitle.hidden = true;
			pcount.textContent = "";
			pbar.style.width = "0";
			return;
		}
		ui = Math.min(at, units.length - 1);
		go(ui, true);
	}
	function wake() {
		pres.classList.remove("idle");
		clearTimeout(idleT);
		idleT = setTimeout(() => pres.classList.add("idle"), 2500);
	}
	function openPres() {
		if (isOpen) return;
		units = buildUnits();
		isOpen = true;
		document.activeElement?.blur?.();
		ed.contentEditable = "false"; // hanya baca selama presentasi
		root.style.overflow = "hidden";
		pres.hidden = false;
		start(0);
		pres.focus({ preventScroll: true });
		wake();
		try {
			const rq = pres.requestFullscreen || pres.webkitRequestFullscreen;
			if (rq)
				Promise.resolve(rq.call(pres))
					.then(() => {
						inFs = true;
						try {
							screen.orientation
								?.lock?.("landscape")
								?.catch(() => {});
						} catch {}
					})
					.catch(() => {});
		} catch {}
	}
	function closePres() {
		if (!isOpen) return;
		isOpen = false;
		clearTimeout(idleT);
		pres.hidden = true;
		ed.contentEditable = "true";
		root.style.overflow = "";
		try {
			screen.orientation?.unlock?.();
		} catch {}
		if (document.fullscreenElement)
			document.exitFullscreen?.().catch(() => {});
		inFs = false;
		$("#bpres").focus({ preventScroll: true });
	}
	const next = () => go(ui + 1),
		prev = () => go(ui - 1);
	const slideJump = (d) => {
		const t = slides[si + d];
		if (t) go(t.us[0]);
	};
	// tangkap semua tombol saat presentasi: cegah undo/redo & pintasan editor
	document.addEventListener(
		"keydown",
		(e) => {
			if (!isOpen) return;
			e.stopImmediatePropagation();
			const k = e.key;
			if (e.ctrlKey || e.metaKey || e.altKey) {
				if (k.toLowerCase() === "s") e.preventDefault();
				return;
			}
			wake();
			let h = true;
			if (k === "Escape") closePres();
			else if (k === " " && e.shiftKey) prev();
			else if (
				k === "ArrowDown" ||
				k === "PageDown" ||
				k === " " ||
				k === "Enter"
			)
				next();
			else if (k === "ArrowUp" || k === "PageUp" || k === "Backspace")
				prev();
			else if (k === "ArrowRight") slideJump(1);
			else if (k === "ArrowLeft") slideJump(-1);
			else if (k === "Home") go(0);
			else if (k === "End") go(units.length - 1);
			else if (k === "f" || k === "F") pres.classList.toggle("nofx");
			else h = false;
			if (h) e.preventDefault();
		},
		true,
	);
	$("#bpres").onclick = openPres;
	$("#pclose").onclick = closePres;
	$("#pnext").onclick = next;
	$("#pprev").onclick = prev;
	pres.addEventListener("mousemove", wake);
	let t0 = null;
	pres.addEventListener(
		"touchstart",
		(e) => {
			const t = e.touches[0];
			t0 = [t.clientX, t.clientY];
			wake();
		},
		{ passive: true },
	);
	pres.addEventListener("touchend", (e) => {
		if (!t0) return;
		const t = e.changedTouches[0],
			rot = pres.classList.contains("rot"),
			dx = t.clientX - t0[0],
			dy = t.clientY - t0[1],
			d = rot ? dy : dx, // layar diputar: sumbu geser ikut berputar
			o = rot ? dx : dy;
		t0 = null;
		if (Math.abs(d) > 60 && Math.abs(d) > Math.abs(o) * 1.5)
			d < 0 ? next() : prev();
	});
	const relayout = () => {
		if (isOpen) start(ui);
	};
	const re = () => {
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(relayout);
	};
	addEventListener("resize", re);
	addEventListener("orientationchange", re);
	document.addEventListener("fullscreenchange", () => {
		if (isOpen && inFs && !document.fullscreenElement) closePres();
	});
}

let curEl = null;
render();
normalize();
idb.whenSynced.then(() => migrateLegacy());
initCloud().catch((e) => {
	$("#cl").textContent = "mode lokal (" + e.message + ")";
});
