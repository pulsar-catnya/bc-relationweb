

 
(() => {
"use strict";

 

const RWNow = () => Date.now();
const RWLog = (...a) => console.log("[RelationWeb]", ...a);
const RWErr = (...a) => console.error("[RelationWeb]", ...a);

 
const RW_SAVE_MAX_CHARS = 8 * 1024 * 1024;
 
const RW_MAX_PERSONS = 20000;
const RW_MAX_EDGES = 50000;
let RWMaxWarned = false;

 
function RWPruneCountMap(map, keep) {
	const keys = Object.keys(map);
	if (keys.length <= keep) return;
	keys.sort((a, b) => (map[b] || 0) - (map[a] || 0));
	for (let i = keep; i < keys.length; i++) delete map[keys[i]];
}

 
const RWStorage = {
	get(key) {
		try { return localStorage.getItem(key); } catch (e) { return null; }
	},
	set(key, value) {
		try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
	},
	remove(key) {
		try { localStorage.removeItem(key); } catch (e) {   }
	},
};

 

const RWStore = {
	legacyKey: "RelationWebData",   
	accountNum: null,               
	state: null,

	 
	baseKey() {
		return this.accountNum ? ("RelationWebData:" + this.accountNum) : null;
	},

	emptyState() {
		return { v: 2, maxPersonId: 0, persons: [], edges: [] };
	},

	 
	normalize(s) {
		
		const legacyDesc = !s.v || s.v < 3;
		s.v = 3;
		s.persons.forEach(p => {
			if (!Array.isArray(p.nums)) p.nums = [];
			
			if (!p.names || typeof p.names !== "object" || Array.isArray(p.names)) p.names = {};
			if (!p.numNames || typeof p.numNames !== "object" || Array.isArray(p.numNames)) p.numNames = {};
			if (!p.nicknames || typeof p.nicknames !== "object" || Array.isArray(p.nicknames)) p.nicknames = {};
			if (!p.numDescs || typeof p.numDescs !== "object" || Array.isArray(p.numDescs)) p.numDescs = {};
			
			if (legacyDesc && typeof p.desc === "string" && p.desc && p.nums.length === 1 && !Object.prototype.hasOwnProperty.call(p.numDescs, String(p.nums[0]))) {
				p.numDescs[String(p.nums[0])] = p.desc;
			}
			
			for (const k of Object.keys(p.numDescs)) {
				if (!p.nums.includes(Number(k))) delete p.numDescs[k];
			}
		});
		s.edges.forEach(e => {
			if (!Array.isArray(e.aNums)) e.aNums = [];
			if (!Array.isArray(e.bNums)) e.bNums = [];
		});
		return s;
	},

	 
	parseRaw(raw) {
		if (typeof raw !== "string" || !raw) return null;
		let json = raw;
		if (raw.startsWith("RWZ:")) {
			if (typeof LZString === "undefined" || !LZString.decompressFromUTF16) return null;
			try { json = LZString.decompressFromUTF16(raw.slice(4)) || ""; } catch (e) { return null; }
		}
		try {
			const s = JSON.parse(json);
			if (s && typeof s === "object" && Array.isArray(s.persons) && Array.isArray(s.edges)) return s;
		} catch (e) {   }
		return null;
	},

	load() {
		if (this.state) return this.state;
		this.state = this.normalize(this.emptyState());
		if (this.accountNum) {
			const raw = RWStorage.get(this.baseKey());
			const s = this.parseRaw(raw);
			if (s) this.state = this.normalize(s);
		}
		return this.state;
	},

	save() {
		if (!this.state || !this.accountNum) return false; 
		try {
			const json = JSON.stringify(this.state);
			
			
			if (json.length > RW_SAVE_MAX_CHARS) {
				if (!RWStore._sizeWarned) {
					RWStore._sizeWarned = true;
					RWLog("数据量已超过落盘上限（" + (RW_SAVE_MAX_CHARS / 1048576) + "MB），暂停写入本地存储（当前会话数据仍在内存中，请导出 txt 备份）");
				}
				return false;
			}
			let payload = json;
			
			if (typeof LZString !== "undefined" && LZString.compressToUTF16) {
				try {
					const compressed = LZString.compressToUTF16(json);
					if (compressed && compressed.length < json.length) payload = "RWZ:" + compressed;
				} catch (e) {   }
			}
			return RWStorage.set(this.baseKey(), payload);
		} catch (e) {
			return false;
		}
	},

	

 
	ensureAccount(num) {
		if (!Number.isInteger(num) || num <= 0) return;
		if (this.accountNum === num) return;

		
		const wasDetached = !this.accountNum;

		
		if (this.accountNum && this.state) {
			try { this.save(); } catch (e) {   }
		}
		
		const pending = (wasDetached && this.state && this.state.persons && this.state.persons.length) ? this.state : null;

		
		this.accountNum = num;
		const s = this.parseRaw(RWStorage.get(this.baseKey()));
		if (s) {
			this.state = this.normalize(s);
		} else {
			this.state = this.normalize(this.emptyState());
		}

		
		if (this.state.persons.length === 0) {
			const legacy = RWStorage.get(this.legacyKey);
			if (legacy) {
				const ls = this.parseRaw(legacy);
				if (ls) {
					this.state = this.normalize(ls);
					this.save();
				}
				RWStorage.remove(this.legacyKey);
			}
		}

		
		if (pending) {
			try {
				RWImportJSON(JSON.stringify({ v: 2, persons: pending.persons, edges: pending.edges }));
			} catch (e) { RWErr("临时数据合并失败", e); }
			RWStore.requestSave();
		}
	},

	 
	_pendingTimer: null,
	requestSave() {
		if (RWStore._pendingTimer) return;
		RWStore._pendingTimer = setTimeout(() => {
			RWStore._pendingTimer = null;
			RWStore.save();
		}, 2000); 
	},

	nextId() {
		const s = RWStore.load();
		s.maxPersonId += 1;
		return "p" + s.maxPersonId;
	},
};

 

function RWFindPersonById(id) {
	return RWStore.load().persons.find(p => p.id === id) ?? null;
}

function RWFindPersonByNum(num) {
	return RWStore.load().persons.find(p => p.nums.includes(num)) ?? null;
}

 
function RWPersonOfNum(num) {
	return RWFindPersonByNum(num);
}

 
function RWMainName(p) {
	if (!p) return "?";
	let best = null, bestCount = 0;
	for (const [name, count] of Object.entries(p.names || {})) {
		if (count > bestCount || (count === bestCount && best !== null && name.length < best.length)) {
			best = name; bestCount = count;
		}
	}
	if (best) return best;
	const ns = p.nums || [];
	return ns.length ? ("#" + ns[ns.length - 1]) : "?";
}

 
function RWMainDisplayName(p) {
	if (!p) return "?";
	let best = null, bestCount = 0;
	for (const [nick, count] of Object.entries(p.nicknames || {})) {
		if (count > bestCount || (count === bestCount && best !== null && nick.length < best.length)) {
			best = nick; bestCount = count;
		}
	}
	if (best) return best;
	return RWMainName(p);
}

 

 
function RWRecordAccount(num, name, meta) {
	if (!Number.isInteger(num) || num <= 0) return;
	meta = meta || {};
	const ts = meta.ts || RWNow();
	const s = RWStore.load();
	let p = RWFindPersonByNum(num);
	if (!p) {
		if (s.persons.length >= RW_MAX_PERSONS) {
			if (!RWMaxWarned) { RWMaxWarned = true; RWLog("人数已达上限（" + RW_MAX_PERSONS + "），不再新增记录"); }
			return null;
		}
		p = {
			id: RWStore.nextId(),
			nums: [num],
			numNames: {},
			names: {},
			nicknames: {},
			numDescs: {},
			title: "", desc: "", note: "",
			first: ts, last: ts,
			isSelf: !!meta.self,
			ownsOwnAlt: false,
		};
		s.persons.push(p);
	}
	if (typeof name === "string" && name.trim()) {
		const nm = name.trim();
		p.names[nm] = (p.names[nm] || 0) + 1;
		p.numNames[num] = nm;
		RWPruneCountMap(p.names, 10);
	}
	if (typeof meta.nickname === "string" && meta.nickname.trim()) {
		const nk = meta.nickname.trim();
		p.nicknames[nk] = (p.nicknames[nk] || 0) + 1;
		RWPruneCountMap(p.nicknames, 10);
	}
	if (typeof meta.title === "string" && meta.title && !p.title) p.title = meta.title;
	if (typeof meta.desc === "string" && meta.desc && meta.desc.length > (p.desc || "").length) {
		p.desc = meta.desc;
	}
	
	if (typeof meta.desc === "string") {
		if (meta.desc) p.numDescs[num] = meta.desc;
		else delete p.numDescs[num];
	}
	if (meta.self) p.isSelf = true;
	p.first = Math.min(p.first, ts);
	p.last = Math.max(p.last, ts);
	RWStore.requestSave();
	return p;
}

 
function RWRecordRelationship(fromNum, fromName, toNum, toName, kind, ts) {
	if (!Number.isInteger(fromNum) || !Number.isInteger(toNum) || fromNum <= 0 || toNum <= 0) return null;
	if (fromNum === toNum) {
		
		return null;
	}
	ts = ts || RWNow();
	const pa = RWEnsurePerson(fromNum, fromName, ts);
	const pb = RWEnsurePerson(toNum, toName, ts);
	if (pa.id === pb.id) {
		
		if (kind === "owner") { pa.ownsOwnAlt = true; RWStore.requestSave(); }
		return null;
	}
	const s = RWStore.load();

	
	let aId = pa.id, bId = pb.id, aNums = [fromNum], bNums = [toNum];
	if (kind !== "owner" && aId > bId) {
		[aId, bId] = [bId, aId];
		[aNums, bNums] = [bNums, aNums];
	}

	let edge = s.edges.find(e => e.kind === kind && e.a === aId && e.b === bId);
	if (!edge) {
		if (s.edges.length >= RW_MAX_EDGES) {
			if (!RWMaxWarned) { RWMaxWarned = true; RWLog("关系边已达上限（" + RW_MAX_EDGES + "），不再新增记录"); }
			return null;
		}
		edge = { a: aId, b: bId, kind, aNums: [], bNums: [], since: ts, last: ts };
		s.edges.push(edge);
	}
	for (const n of aNums) if (!edge.aNums.includes(n)) edge.aNums.push(n);
	for (const n of bNums) if (!edge.bNums.includes(n)) edge.bNums.push(n);
	if (edge.aNums.length > 50) edge.aNums = edge.aNums.slice(-50);
	if (edge.bNums.length > 50) edge.bNums = edge.bNums.slice(-50);
	edge.since = Math.min(edge.since, ts);
	edge.last = Math.max(edge.last, ts);
	RWStore.requestSave();
	return edge;
}

 
function RWEnsurePerson(num, name, ts) {
	let p = RWFindPersonByNum(num);
	if (p) {
		if (typeof name === "string" && name.trim() && !p.numNames[num]) {
			p.numNames[num] = name.trim();
		}
		p.last = Math.max(p.last, ts || RWNow());
		return p;
	}
	return RWRecordAccount(num, name, { ts });
}

 
function RWMarkSeen(nums, ts) {
	if (!Array.isArray(nums)) return;
	ts = ts || RWNow();
	let dirty = false;
	for (const num of nums) {
		if (!Number.isInteger(num) || num <= 0) continue;
		const p = RWFindPersonByNum(num);
		if (p && ts > p.last) { p.last = ts; dirty = true; }
	}
	if (dirty) RWStore.requestSave();
}

 

 
function RWMergePersons(idA, idB) {
	const s = RWStore.load();
	const pA = RWFindPersonById(idA);
	const pB = RWFindPersonById(idB);
	if (!pA || !pB || pA.id === pB.id) return pA || null;

	
	for (const num of pB.nums) if (!pA.nums.includes(num)) pA.nums.push(num);
	if (pA.nums.length > 50) pA.nums = pA.nums.slice(-50);
	for (const [num, name] of Object.entries(pB.numNames || {})) {
		const n = Number(num);
		if (!pA.numNames[n]) pA.numNames[n] = name;
	}
	for (const [name, count] of Object.entries(pB.names || {})) {
		pA.names[name] = (pA.names[name] || 0) + count;
	}
	for (const [nick, count] of Object.entries(pB.nicknames || {})) {
		pA.nicknames[nick] = (pA.nicknames[nick] || 0) + count;
	}
	if (!pA.title && pB.title) pA.title = pB.title;
	if (pB.desc && pB.desc.length > (pA.desc || "").length) pA.desc = pB.desc;
	
	for (const [num, desc] of Object.entries(pB.numDescs || {})) {
		const n = Number(num);
		if (typeof desc === "string" && desc && !pA.numDescs[n]) pA.numDescs[n] = desc;
	}
	if (pB.note) pA.note = (pA.note ? pA.note + "\n" : "") + "【合并自 " + (RWMainName(pB)) + " 的备注】" + pB.note;
	pA.first = Math.min(pA.first, pB.first);
	pA.last = Math.max(pA.last, pB.last);
	pA.isSelf = pA.isSelf || pB.isSelf;
	pA.ownsOwnAlt = pA.ownsOwnAlt || pB.ownsOwnAlt;

	
	const newEdges = [];
	for (const e of s.edges) {
		if (e.a === pB.id) e.a = pA.id;
		if (e.b === pB.id) e.b = pA.id;
		if (e.a === e.b) {
			
			if (e.kind === "owner") pA.ownsOwnAlt = true;
			continue; 
		}
		
		if (e.kind !== "owner" && e.a > e.b) {
			[e.a, e.b] = [e.b, e.a];
			[e.aNums, e.bNums] = [e.bNums, e.aNums];
		}
		const dup = newEdges.find(x => x.kind === e.kind && x.a === e.a && x.b === e.b);
		if (dup) {
			for (const n of e.aNums) if (!dup.aNums.includes(n)) dup.aNums.push(n);
			for (const n of e.bNums) if (!dup.bNums.includes(n)) dup.bNums.push(n);
			dup.since = Math.min(dup.since, e.since);
			dup.last = Math.max(dup.last, e.last);
		} else {
			newEdges.push(e);
		}
	}
	s.edges = newEdges;

	
	s.persons = s.persons.filter(p => p.id !== pB.id);
	RWStore.requestSave();
	return pA;
}

 
function RWUnmergeNum(personId, num) {
	const s = RWStore.load();
	const p = RWFindPersonById(personId);
	if (!p || !p.nums.includes(num) || p.nums.length < 2) return null;

	
	const ts = RWNow();
	const np = {
		id: RWStore.nextId(),
		nums: [num],
		numNames: {},
		names: {},
		nicknames: {},
		numDescs: {},
		title: "", desc: "", note: "",
		first: p.first, last: p.last,
		isSelf: false,
		ownsOwnAlt: false,
	};
	const lastName = p.numNames[num];
	if (lastName) { np.names[lastName] = 1; np.numNames[num] = lastName; }
	
	const ownDesc = typeof p.numDescs[num] === "string" ? p.numDescs[num] : "";
	if (ownDesc) { np.numDescs[num] = ownDesc; np.desc = ownDesc; }
	s.persons.push(np);

	
	p.nums = p.nums.filter(n => n !== num);
	delete p.numNames[num];
	delete p.numDescs[num];
	
	if (ownDesc && p.desc === ownDesc) {
		let best = "";
		for (const d of Object.values(p.numDescs)) {
			if (typeof d === "string" && d.length > best.length) best = d;
		}
		p.desc = best;
	}

	
	const newEdges = [];
	for (const e of s.edges) {
		let eChanged = false;
		if (e.a === p.id && e.aNums.includes(num)) { e.a = np.id; eChanged = true; }
		if (e.b === p.id && e.bNums.includes(num)) { e.b = np.id; eChanged = true; }
		if (eChanged) {
			if (e.a === e.b) {
				if (e.kind === "owner") np.ownsOwnAlt = true;
				continue; 
			}
			if (e.kind !== "owner" && e.a > e.b) {
				[e.a, e.b] = [e.b, e.a];
				[e.aNums, e.bNums] = [e.bNums, e.aNums];
			}
		}
		newEdges.push(e);
	}
	s.edges = newEdges;
	RWStore.requestSave();
	return np;
}

 
function RWDeletePerson(personId) {
	const s = RWStore.load();
	if (!RWFindPersonById(personId)) return false;
	s.persons = s.persons.filter(p => p.id !== personId);
	s.edges = s.edges.filter(e => e.a !== personId && e.b !== personId);
	RWStore.requestSave();
	return true;
}

 
function RWClearAll() {
	RWStore.state = RWStore.emptyState();
	RWStore.save();
}

 

function RWExportJSON() {
	return JSON.stringify({
		v: RWStore.load().v,
		persons: RWStore.load().persons,
		edges: RWStore.load().edges,
	}, null, 2);
}

 
function RWImportJSON(json) {
	let data;
	try { data = JSON.parse(json); } catch (e) {
		throw Object.assign(new Error("JSON 解析失败"), { rwCode: "jsonParse" });
	}
	if (!data || !Array.isArray(data.persons) || !Array.isArray(data.edges)) {
		throw Object.assign(new Error("不是有效的 RelationWeb 导出数据"), { rwCode: "notValid" });
	}
	const s = RWStore.load();

	
	const idMap = new Map();
	const getNewId = (key) => {
		if (!idMap.has(key)) idMap.set(key, RWStore.nextId());
		return idMap.get(key);
	};

	
	const preExistingIds = new Set(s.persons.map(p => p.id));

	
	let addedPersons = 0;
	const imported = [];
	const numToItem = new Map();
	let importIndex = 0;
	for (const ip of data.persons) {
		if (!ip || !Array.isArray(ip.nums) || !ip.nums.length) continue;
		
		let np = null;
		for (const num of ip.nums) {
			const claimed = numToItem.get(num);
			if (claimed) { np = claimed.person; break; }
		}
		let isNew = false;
		if (!np) {
			const exist = RWFindPersonByNum(ip.nums[0]);
			if (exist) {
				np = exist;
			} else {
				np = {
					id: getNewId("imp" + (importIndex++)),
					nums: [],
					numNames: {},
					names: {},
					nicknames: {},
					numDescs: {},
					title: "", desc: "", note: "",
					first: ip.first || RWNow(), last: ip.last || RWNow(),
					isSelf: false, ownsOwnAlt: !!ip.ownsOwnAlt,
				};
				s.persons.push(np);
				addedPersons++;
				isNew = true;
			}
		}
		
		for (const [num, name] of Object.entries(ip.numNames || {})) {
			const n = Number(num);
			if (!np.numNames[n]) np.numNames[n] = name;
		}
		for (const [name, count] of Object.entries(ip.names || {})) {
			np.names[name] = (np.names[name] || 0) + (count || 1);
		}
		for (const [nick, count] of Object.entries(ip.nicknames || {})) {
			np.nicknames[nick] = (np.nicknames[nick] || 0) + (count || 1);
		}
		if (ip.title && !np.title) np.title = ip.title;
		if (ip.desc && ip.desc.length > (np.desc || "").length) np.desc = ip.desc;
		
		for (const [num, desc] of Object.entries(ip.numDescs || {})) {
			const n = Number(num);
			if (typeof desc === "string" && desc && !np.numDescs[n]) np.numDescs[n] = desc;
		}
		
		if (ip.nums.length === 1 && typeof ip.desc === "string" && ip.desc && !np.numDescs[ip.nums[0]]) {
			np.numDescs[ip.nums[0]] = ip.desc;
		}
		if (ip.note && !np.note.includes(ip.note)) {
			np.note = np.note ? np.note + "\n" + ip.note : ip.note;
		}
		np.first = Math.min(np.first, ip.first || RWNow());
		np.last = Math.max(np.last, ip.last || 0);
		np.isSelf = np.isSelf || !!ip.isSelf;
		for (const num of ip.nums) {
			if (!numToItem.has(num)) numToItem.set(num, { person: np });
		}
		imported.push({ oldId: ip.id, person: np, nums: ip.nums.slice(), isNew });
	}

	
	const oldToNew = new Map();
	for (const item of imported) {
		oldToNew.set(item.oldId, item.person.id);
	}
	
	const absorbedTo = new Map();
	const resolveId = (id) => {
		let cur = id;
		const seen = new Set();
		while (absorbedTo.has(cur) && !seen.has(cur)) {
			seen.add(cur);
			cur = absorbedTo.get(cur);
		}
		return cur;
	};

	
	for (const item of imported) {
		for (const num of item.nums) {
			const existing = RWFindPersonByNum(num);
			if (!existing) continue;
			const curId = resolveId(item.person.id);
			if (existing.id === curId) continue;
			let survivor = curId, absorbed = existing.id;
			
			if (!preExistingIds.has(curId) && preExistingIds.has(existing.id)) {
				survivor = existing.id;
				absorbed = curId;
			}
			absorbed = resolveId(absorbed);
			if (absorbed === survivor) continue;
			const merged = RWMergePersons(survivor, absorbed);
			if (merged) absorbedTo.set(absorbed, merged.id);
		}
	}

	
	for (const item of imported) {
		const person = RWFindPersonById(resolveId(item.person.id));
		if (!person) continue;
		for (const num of item.nums) {
			if (!person.nums.includes(num)) person.nums.push(num);
		}
	}

	
	let addedEdges = 0;
	for (const ie of data.edges) {
		if (!ie || (ie.kind !== "owner" && ie.kind !== "lover" && ie.kind !== "friend")) continue;
		const aId = resolveId(oldToNew.get(ie.a) ?? "");
		const bId = resolveId(oldToNew.get(ie.b) ?? "");
		if (!aId || !bId || aId === bId) continue;
		const dup = s.edges.find(e => e.kind === ie.kind && e.a === aId && e.b === bId);
		if (!dup) {
			s.edges.push({
				a: aId, b: bId, kind: ie.kind,
				aNums: Array.isArray(ie.aNums) ? ie.aNums.slice() : [],
				bNums: Array.isArray(ie.bNums) ? ie.bNums.slice() : [],
				since: ie.since || RWNow(), last: ie.last || RWNow(),
			});
			addedEdges++;
		}
	}
	RWStore.requestSave();
	return { addedPersons, addedEdges };
}

 

 
const RWCollectSeen = new Map(); 
const RW_DEDUPE_WINDOW = 10000;
const RW_DEDUPE_MAX = 3000;

function RWCollectSig(data) {
	if (!data || typeof data !== "object") return "";
	const lovershipSig = Array.isArray(data.Lovership)
		? data.Lovership.map(L => (L && L.MemberNumber) + ":" + (L && L.Stage)).join(",")
		: "";
	const ow = data.Ownership;
	const owSig = ow && typeof ow === "object" ? ((ow.MemberNumber || 0) + ":" + (ow.Stage || 0)) : "";
	return [data.Name, data.Nickname, data.Title, data.Description && data.Description.length, owSig, lovershipSig].join("|");
}

function RWCollectDedupe(num, sig) {
	const ts = RWNow();
	const seen = RWCollectSeen.get(num);
	if (seen && seen.sig === sig && (ts - seen.ts) < RW_DEDUPE_WINDOW) {
		seen.ts = ts;
		return true; 
	}
	RWCollectSeen.set(num, { sig, ts });
	
	if (RWCollectSeen.size > RW_DEDUPE_MAX) {
		const cutoff = ts - RW_DEDUPE_WINDOW;
		for (const [k, v] of RWCollectSeen) {
			if (v.ts < cutoff) RWCollectSeen.delete(k);
		}
		if (RWCollectSeen.size > RW_DEDUPE_MAX) {
			
			let n = 0;
			for (const k of RWCollectSeen.keys()) {
				RWCollectSeen.delete(k);
				if (++n >= RW_DEDUPE_MAX / 2) break;
			}
		}
	}
	return false;
}

 
function RWCollectFromSync(data) {
	if (!data || typeof data !== "object" || Array.isArray(data)) return;
	
	if (typeof Player !== "undefined" && Player && Number.isInteger(Player.MemberNumber) && Player.MemberNumber > 0) {
		RWStore.ensureAccount(Player.MemberNumber);
	}
	const num = data.MemberNumber;
	if (!Number.isInteger(num) || num <= 0 || typeof data.Name !== "string" || !data.Name) return;
	
	if (RWCollectDedupe(num, RWCollectSig(data))) return;
	const ts = RWNow();
	RWRecordAccount(num, data.Name, {
		title: typeof data.Title === "string" ? data.Title : "",
		nickname: typeof data.Nickname === "string" ? data.Nickname : "",
		desc: typeof data.Description === "string" ? data.Description : "",
		ts,
	});
	
	const ow = data.Ownership;
	if (ow && typeof ow === "object" && Number.isInteger(ow.MemberNumber) && ow.MemberNumber > 0 && typeof ow.Name === "string") {
		RWRecordRelationship(ow.MemberNumber, ow.Name, num, data.Name, "owner", ts);
	}
	
	if (Array.isArray(data.Lovership)) {
		for (const L of data.Lovership) {
			if (L && typeof L === "object" && Number.isInteger(L.MemberNumber) && L.MemberNumber > 0 && typeof L.Name === "string") {
				RWRecordRelationship(num, data.Name, L.MemberNumber, L.Name, "lover", ts);
			}
		}
	}
}

 
function RWCollectFromChar(C) {
	if (!C || typeof C !== "object") return;
	
	if (typeof Player !== "undefined" && Player && Number.isInteger(Player.MemberNumber) && Player.MemberNumber > 0) {
		RWStore.ensureAccount(Player.MemberNumber);
	}
	const num = C.MemberNumber;
	if (!Number.isInteger(num) || num <= 0 || typeof C.Name !== "string" || !C.Name) return;
	
	if (RWCollectDedupe(num, RWCollectSig(C))) return;
	const ts = RWNow();
	RWRecordAccount(num, C.Name, {
		title: typeof C.Title === "string" ? C.Title : "",
		nickname: typeof C.Nickname === "string" ? C.Nickname : "",
		desc: typeof C.Description === "string" ? C.Description : "",
		ts,
	});
	const ow = C.Ownership;
	if (ow && typeof ow === "object" && Number.isInteger(ow.MemberNumber) && ow.MemberNumber > 0 && typeof ow.Name === "string") {
		RWRecordRelationship(ow.MemberNumber, ow.Name, num, C.Name, "owner", ts);
	}
	if (Array.isArray(C.Lovership)) {
		for (const L of C.Lovership) {
			if (L && typeof L === "object" && Number.isInteger(L.MemberNumber) && L.MemberNumber > 0 && typeof L.Name === "string") {
				RWRecordRelationship(num, C.Name, L.MemberNumber, L.Name, "lover", ts);
			}
		}
	}
}

 
function RWCollectFromDictionary(dict) {
	if (!Array.isArray(dict)) return;
	const ts = RWNow();
	const nums = [];
	for (const d of dict) {
		if (!d || typeof d !== "object") continue;
		for (const key of ["MemberNumber", "TargetCharacter", "SourceCharacter"]) {
			if (Number.isInteger(d[key]) && d[key] > 0) nums.push(d[key]);
		}
	}
	RWMarkSeen(nums, ts);
}

 
function RWCollectFromPlayer() {
	if (typeof Player === "undefined" || !Player) return;
	const P = Player;
	const ts = RWNow();
	if (!Number.isInteger(P.MemberNumber) || typeof P.Name !== "string" || !P.Name) return;
	
	RWStore.ensureAccount(P.MemberNumber);

	RWRecordAccount(P.MemberNumber, P.Name, {
		title: typeof P.Title === "string" ? P.Title : "",
		nickname: typeof P.Nickname === "string" ? P.Nickname : "",
		desc: typeof P.Description === "string" ? P.Description : "",
		ts, self: true,
	});
	const ow = P.Ownership;
	if (ow && typeof ow === "object" && Number.isInteger(ow.MemberNumber) && ow.MemberNumber > 0) {
		RWRecordRelationship(ow.MemberNumber, ow.Name, P.MemberNumber, P.Name, "owner", ts);
	}
	if (Array.isArray(P.Lovership)) {
		for (const L of P.Lovership) {
			if (L && typeof L === "object" && Number.isInteger(L.MemberNumber) && L.MemberNumber > 0) {
				RWRecordRelationship(P.MemberNumber, P.Name, L.MemberNumber, L.Name, "lover", ts);
			}
		}
	}
	
	const friendName = (n) => {
		if (P.FriendNames) {
			if (typeof P.FriendNames.get === "function") return P.FriendNames.get(n);
			if (P.FriendNames[n] && typeof P.FriendNames[n] === "object") return P.FriendNames[n].Name;
			if (typeof P.FriendNames[n] === "string") return P.FriendNames[n];
		}
		return undefined;
	};
	if (Array.isArray(P.FriendList)) {
		for (const fn of P.FriendList) {
			if (!Number.isInteger(fn)) continue;
			const nm = friendName(fn);
			RWRecordRelationship(P.MemberNumber, P.Name, fn, typeof nm === "string" && nm ? nm : undefined, "friend", ts);
		}
	}
	
	if (P.SubmissivesList) {
		const subs = typeof P.SubmissivesList.forEach === "function"
			? Array.from(P.SubmissivesList)
			: Object.keys(P.SubmissivesList).map(Number);
		for (const sn of subs) {
			if (!Number.isInteger(sn)) continue;
			const nm = friendName(sn);
			RWRecordRelationship(P.MemberNumber, P.Name, sn, typeof nm === "string" && nm ? nm : undefined, "owner", ts);
		}
	}
}

 
function RWCollectAll() {
	RWCollectFromPlayer();
	if (typeof Character !== "undefined" && Array.isArray(Character)) {
		for (const C of Character) {
			if (!C || C === Player || !Number.isInteger(C.MemberNumber) || C.MemberNumber <= 0) continue;
			if (typeof C.AccountName === "string" && C.AccountName.startsWith("Online")) {
				RWCollectFromChar(C);
			}
		}
	}
	if (typeof ChatRoomCharacter !== "undefined" && Array.isArray(ChatRoomCharacter)) {
		for (const C of ChatRoomCharacter) RWCollectFromChar(C);
	}
}

 

const RWUI = {
	
	win: null,
	titlebar: null,
	toolbar: null,
	body: null,
	canvas: null,
	ctx: null,
	side: null,
	legend: null,
	resizeHandle: null,
	toastEl: null,
	styleEl: null,
	descPanel: null,       
	descTitle: null,
	descContent: null,
	descSwitcher: null,    
	descButtons: null,     
	descPersonId: null,    
	descNum: null,         

	
	open: false,
	minimized: false,
	geo: { x: 80, y: 80, w: 820, h: 560 },
	lang: "zh",           

	
	nodes: new Map(),      
	view: { x: 0, y: 0, scale: 1 },
	viewInit: false,       
	selId: null,
	hoverId: null,
	mergeMode: false,
	mergeFirstId: null,
	drag: null,            
	pan: null,             
	tick: 0,
	phys: false,           
	onlyRelated: false,
	show: { owner: true, lover: true, friend: false },  
	dirty: true,           
	suppressClick: false,  
	searchText: "",        
	pendingCenter: null,   
	hidden: new Set(),     
	hiddenStamp: 0,        
	needDraw: true,        
	visKey: "",            
	visPersons: null,      
	visEdges: null,        
	visEdgesKey: "",       

	
	winDrag: null,         
	resDrag: null,         

	loopId: null,          
	escHandler: null,      
};

let RWCollectIntervalId = null;   
let RWToastTimer = null;

 

const RWText = {
	zh: {
		title: "关系网 RelationWeb — 拖拽移动",
		minimizeTitle: "最小化（只剩标题栏，再点标题栏恢复）",
		closeTitle: "关闭浮窗",
		resizeTitle: "拖动拉伸窗口",
		legendSelf: "金色 = 我",
		legendOwned: "红描边 = 有主人",
		legendTips: "拖标题栏移动 · 拖右下角拉伸 · 点节点看详情",
		legendCmd: "聊天室输入 /rw 开关本窗",
		edgeOwner: "主人", edgeLover: "恋人", edgeFriend: "好友",
		btnRefresh: "刷新数据", btnRefreshTitle: "立即重新采集我/聊天室/好友关系",
		btnMerge: "合并模式", btnMergeOn: "合并模式：开",
		btnMergeTitle: "进入合并模式后，依次点击两个节点，将两个账号标记为同一个人（小号）",
		btnRelated: "仅显示相关", btnRelatedTitle: "只显示与我直接/间接有关系的人（搜索时自动只显示该玩家相关）",
		searchPh: "搜索名字/昵称/ID…", searchClearTitle: "清空搜索",
		btnUnhide: "取消隐藏({0})", btnUnhideTitle: "恢复所有被暂时隐藏的人",
		sideHide: "隐藏", sideHideTitle: "暂时隐藏此人（工具栏可取消隐藏）",
		toastHidden: "已暂时隐藏：{0}", toastUnhidden: "已恢复所有被隐藏的人",
		btnEdge: "{0}边", btnEdgeTitle: "显示/隐藏{0}关系边",
		btnPhysAuto: "布局：自动", btnPhysManual: "布局：手动",
		btnPhysTitle: "切换自动力导向布局（可拖拽节点）",
		btnExport: "导出", btnExportTitle: "复制数据到剪贴板并下载 txt 备份文件",
		btnImport: "导入", btnImportTitle: "从文件或剪贴板导入备份（与现有数据合并）",
		btnClear: "清空", btnClearTitle: "删除全部已收集数据（不可恢复！）",
		btnLangTitle: "切换界面语言 / Switch UI language",
		twoStepConfirm: "点击确认", btnCancel: "取消", btnConfirm: "确定",
		importDialogTitle: "导入备份",
		importDialogMsg: "从文件或剪贴板读取备份，与现有关系网合并。\n\n文件：导出的 txt 备份（内容是 JSON 文本）\n剪贴板：先打开导出的 txt 全选复制，再点「从剪贴板」",
		importBtnFile: "选择文件", importBtnClip: "从剪贴板",
		toastLang: "界面语言：中文",
		toastOpened: "关系网浮窗已打开：{0} 人 / {1} 条关系。拖标题栏移动，拖右下角拉伸，点节点看详情，聊天室再输 /rw 可关闭。",
		toastRefreshed: "数据已刷新：共 {0} 人，{1} 条关系",
		toastNoteSaved: "备注已保存",
		toastMergeFirst: "已选第一个账号，请点击第二个（同一人的小号）",
		toastMergeCancel: "已取消选择",
		toastMerged: "合并完成：{0}",
		toastCleared: "已清空",
		toastExportClip: "已复制到剪贴板，并下载了 txt 备份文件",
		toastExportFile: "txt 备份已下载（剪贴板不可用）",
		toastExportFail: "导出失败：{0}",
		toastImportDone: "导入完成：新增 {0} 人、{1} 条关系",
		toastImportFail: "导入失败：{0}",
		toastImportNoFile: "未选择文件",
		toastImportFileFail: "文件读取失败：{0}",
		toastClipboardNo: "无法读取剪贴板，请改用文件导入",
		toastBuildFail: "关系网浮窗构建失败，请查看控制台",
		confirmMerge: "把「{0}」和「{1}」合并为同一个人？\n\n账号将汇总：{2}\n主人/恋人/好友关系会自动整合。{3}",
		confirmMergeWarn: "\n\n⚠ 注意：两人之间存在关系，合并后会标记为「自拥小号」。",
		confirmUnmerge: "确定把账号 #{0} 拆出为独立的人吗？",
		confirmDelete: "确定删除 {0} 及其全部关系吗？",
		confirmClear: "确定要清空全部关系网数据吗？此操作不可恢复！",
		sideAccount: "账号 #{0}", sideMe: "（我）",
		sideUnmerge: "拆出", sideUnmergeTitle: "把这个账号从当前人中拆出（恢复为独立节点）",
		sideTitleLabel: "称号：{0}", sideDescLabel: "描述：{0}", sideNameLabel: "名字：{0}",
		descBtn: "查看完整BIO", descBtnTitle: "BIO 共 {0} 字，点击打开完整 BIO 面板（可滚动）",
		descBtnTitleMulti: "BIO 共 {0} 字；该玩家已合并多个账号，面板内可切换查看各账号的 BIO",
		descPanelTitle: "完整 BIO · {0}",
		descDefaultTab: "默认",
		descNoBio: "（此账号暂无 BIO）",
		sideNoteLabel: "我的备注：", sideNotePh: "给这个人写点备注（小号信息、性格等）…",
		sideRelsLabel: "关系（{0}）：",
		sideOwnedSelf: "我拥有 {0}", sideOwnerSelf: "我的主人：{0}",
		sideOwnedOther: "拥有 {0}", sideOwnerOther: "主人：{0}",
		sideLover: "恋人：{0}", sideFriend: "好友：{0}",
		sideNoRels: "暂无已记录的关系",
		sideDelete: "删除此人", sideClose: "关闭面板",
		hintMergePick1: "合并模式：请点击第一个账号",
		hintMergePick2: "已选第一个，请点击第二个账号（同一人）",
		nodeAccts: "{0}账号", nodeOwnAlt: "自拥小号",
		errJsonParse: "JSON 解析失败",
		errNotValid: "不是有效的 RelationWeb 导出数据",
	},
	en: {
		title: "Relation Web — drag to move",
		minimizeTitle: "Minimize (click again to restore)",
		closeTitle: "Close window",
		resizeTitle: "Drag to resize",
		legendSelf: "Gold = me",
		legendOwned: "Red ring = owned",
		legendTips: "Drag title to move · drag corner to resize · click node for details",
		legendCmd: "Type /rw in chat to toggle",
		edgeOwner: "Owner", edgeLover: "Lover", edgeFriend: "Friend",
		btnRefresh: "Refresh", btnRefreshTitle: "Re-collect me / chatroom / friends now",
		btnMerge: "Merge mode", btnMergeOn: "Merge: ON",
		btnMergeTitle: "In merge mode, click two nodes to mark them as the same person (alt accounts)",
		btnRelated: "Only related", btnRelatedTitle: "Only show people connected to me (search auto-shows only that player's related web)",
		searchPh: "Search name / nickname / ID…", searchClearTitle: "Clear search",
		btnUnhide: "Unhide ({0})", btnUnhideTitle: "Restore all temporarily hidden people",
		sideHide: "Hide", sideHideTitle: "Temporarily hide this person (toolbar can unhide)",
		toastHidden: "Hidden: {0}", toastUnhidden: "All hidden people restored",
		btnEdge: "{0} edge", btnEdgeTitle: "Show/hide {0} edges",
		btnPhysAuto: "Layout: auto", btnPhysManual: "Layout: manual",
		btnPhysTitle: "Toggle auto layout (nodes draggable)",
		btnExport: "Export", btnExportTitle: "Copy data to clipboard and download txt backup",
		btnImport: "Import", btnImportTitle: "Import backup from a file or the clipboard (merge)",
		btnClear: "Clear all", btnClearTitle: "Delete ALL collected data (irreversible!)",
		btnLangTitle: "切换界面语言 / Switch UI language",
		twoStepConfirm: "Click to confirm", btnCancel: "Cancel", btnConfirm: "OK",
		importDialogTitle: "Import backup",
		importDialogMsg: "Load a backup from a file or the clipboard and merge it into your web.\n\nFile: the exported .txt backup (JSON text inside)\nClipboard: open the exported txt, select all, copy, then click \"From clipboard\"",
		importBtnFile: "Choose file", importBtnClip: "From clipboard",
		toastLang: "UI language: English",
		toastOpened: "Relation Web opened: {0} people / {1} edges. Drag title to move, drag corner to resize, click a node for details, type /rw again to close.",
		toastRefreshed: "Data refreshed: {0} people, {1} edges",
		toastNoteSaved: "Note saved",
		toastMergeFirst: "First account selected — click the second (same person's alt)",
		toastMergeCancel: "Selection cancelled",
		toastMerged: "Merged: {0}",
		toastCleared: "Cleared",
		toastExportClip: "Copied to clipboard and downloaded txt backup",
		toastExportFile: "txt backup downloaded (clipboard unavailable)",
		toastExportFail: "Export failed: {0}",
		toastImportDone: "Imported: +{0} people, +{1} edges",
		toastImportFail: "Import failed: {0}",
		toastImportNoFile: "No file selected",
		toastImportFileFail: "File read failed: {0}",
		toastClipboardNo: "Cannot read clipboard — use file import instead",
		toastBuildFail: "Failed to build the window — check console",
		confirmMerge: "Merge \"{0}\" and \"{1}\" into one person?\n\nAccounts: {2}\nOwner/lover/friend relations will be merged automatically.{3}",
		confirmMergeWarn: "\n\n⚠ Note: these two already have a relation; it will become 'owns own alt' after merging.",
		confirmUnmerge: "Split account #{0} into a separate person?",
		confirmDelete: "Delete {0} and all their relations?",
		confirmClear: "Clear ALL collected data? This cannot be undone!",
		sideAccount: "Account #{0}", sideMe: " (me)",
		sideUnmerge: "Split", sideUnmergeTitle: "Split this account out into its own node",
		sideTitleLabel: "Title: {0}", sideDescLabel: "Desc: {0}", sideNameLabel: "Name: {0}",
		descBtn: "View full BIO", descBtnTitle: "{0} chars — click to open the scrollable full BIO",
		descBtnTitleMulti: "{0} chars — this person has merged accounts; switch between each account's BIO inside the panel",
		descPanelTitle: "Full BIO · {0}",
		descDefaultTab: "Default",
		descNoBio: "(no BIO for this account)",
		sideNoteLabel: "My note:", sideNotePh: "Write a note (alts, personality, etc.)…",
		sideRelsLabel: "Relations ({0}):",
		sideOwnedSelf: "I own {0}", sideOwnerSelf: "My owner: {0}",
		sideOwnedOther: "Owns {0}", sideOwnerOther: "Owner: {0}",
		sideLover: "Lover: {0}", sideFriend: "Friend: {0}",
		sideNoRels: "No relations recorded yet",
		sideDelete: "Delete person", sideClose: "Close panel",
		hintMergePick1: "Merge mode: click the first account",
		hintMergePick2: "First selected — click the second account (same person)",
		nodeAccts: "{0} accts", nodeOwnAlt: "owns own alt",
		errJsonParse: "JSON parse failed",
		errNotValid: "Not valid RelationWeb export data",
	},
};

 
function RWT(key, ...args) {
	const dict = RWText[RWUI.lang] || RWText.zh;
	let s = dict[key] ?? RWText.zh[key] ?? key;
	for (let i = 0; i < args.length; i++) {
		s = s.split("{" + i + "}").join(String(args[i]));
	}
	return s;
}

 

function RWUIGeoLoad() {
	try {
		const raw = RWStorage.get("RelationWebWin");
		if (raw) {
			const g = JSON.parse(raw);
			if (g && typeof g === "object") {
				const vw = window.innerWidth || 1000, vh = window.innerHeight || 700;
				RWUI.geo.w = Math.min(Math.max(+g.w || 820, 320), vw - 10);
				RWUI.geo.h = Math.min(Math.max(+g.h || 560, 240), vh - 10);
				RWUI.geo.x = Math.min(Math.max(+g.x || 80, 0), Math.max(0, vw - RWUI.geo.w - 10));
				RWUI.geo.y = Math.min(Math.max(+g.y || 80, 0), Math.max(0, vh - RWUI.geo.h - 10));
			}
		}
	} catch (e) {   }
}

function RWUIGeoSave() {
	try {
		RWStorage.set("RelationWebWin", JSON.stringify(RWUI.geo));
	} catch (e) {   }
}

 

 
function RWRaf(cb) {
	if (typeof requestAnimationFrame === "function") {
		requestAnimationFrame(cb);
	} else {
		setTimeout(cb, 16);
	}
}

 
function RWApplyStyle(el, styles) {
	if (!el || !el.style) return el;
	for (const k of Object.keys(styles)) {
		try { el.style[k] = styles[k]; } catch (e) {   }
	}
	return el;
}

function RWUIEnsureStyle() {
	if (RWUI.styleEl || document.getElementById("rw-style")) return;
	const style = document.createElement("style");
	style.id = "rw-style";
	
	
	style.textContent = [
		"#rw-win{border:4px solid #ffffff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.65);",
		"color:#e8eaf6;font-size:13px;font-family:sans-serif;}",
		"#rw-titlebar{gap:6px;padding:8px 10px;background:#1a1e30;border-bottom:1px solid #2a2f45;}",
		"#rw-title{color:#ffd166;font-weight:bold;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
		"#rw-toolbar{gap:6px;padding:8px;background:#151727;border-bottom:1px solid #2a2f45;}",
		"#rw-side{width:262px;max-width:75%;overflow-y:auto;background:rgba(16,16,28,.96);border:1px solid #3a4160;",
		"border-radius:8px;padding:10px;color:#e8eaf6;font-size:13px;z-index:2;}",
		"#rw-legend{background:rgba(16,16,28,.85);border:1px solid #3a4160;border-radius:8px;padding:6px 10px;",
		"color:#9aa3c7;font-size:12px;line-height:1.7;z-index:2;pointer-events:none;}",
		"#rw-resize::after{content:'';position:absolute;right:4px;bottom:4px;width:10px;height:10px;",
		"border-right:2px solid #8891b8;border-bottom:2px solid #8891b8;}",
		".rw-btn{background:#2a2f45;color:#e8eaf6;border:1px solid #4a5278;border-radius:8px;padding:7px 14px;",
		"font-size:18px;cursor:pointer;line-height:1.3;}",
		".rw-btn:hover{background:#3a4160;}",
		".rw-btn-active{background:#8a6d1a;border-color:#ffd166;}",
		".rw-btn-danger{background:#5c2030;border-color:#ff5566;}",
		".rw-btn-mini{padding:3px 10px;font-size:16px;margin-left:8px;}",
		".rw-btn-title{background:transparent;border:1px solid #4a5278;color:#c5cbe8;border-radius:6px;",
		"width:34px;height:34px;font-size:20px;line-height:1;cursor:pointer;padding:0;}",
		".rw-btn-title:hover{background:#3a4160;}",
		".rw-side-title{font-size:16px;font-weight:bold;color:#ffd166;margin-bottom:8px;}",
		".rw-side-label{margin-top:10px;margin-bottom:4px;color:#9aa3c7;font-size:12px;}",
		".rw-side-info{margin-bottom:6px;color:#c5cbe8;word-break:break-all;}",
		".rw-side-numrow{display:flex;align-items:center;justify-content:space-between;padding:3px 0;color:#ffd166;}",
		".rw-side-note{width:100%;height:64px;background:#1a1e30;color:#e8eaf6;border:1px solid #4a5278;",
		"border-radius:6px;padding:6px;font-size:13px;resize:vertical;box-sizing:border-box;}",
		".rw-side-relrow{display:flex;align-items:center;gap:8px;padding:4px 0;color:#e8eaf6;}",
		".rw-side-reldot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:none;}",
		".rw-side-reldate{margin-left:auto;color:#6d7699;font-size:11px;}",
		".rw-side-empty{color:#6d7699;font-style:italic;}",
		".rw-side-btns{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}",
		"#rw-toast{position:fixed;right:16px;bottom:16px;z-index:2147483600;background:#2a2f45;",
		"border:1px solid #ffd166;color:#ffd166;border-radius:8px;padding:10px 16px;font-size:14px;",
		"font-family:sans-serif;transition:opacity .4s;display:none;max-width:420px;}",
	].join("\n");
	document.head.appendChild(style);
	RWUI.styleEl = style;
}

function RWUIBuildWindow() {
	RWUIEnsureStyle();
	RWUIGeoLoad();

	const win = document.createElement("div");
	win.id = "rw-win";
	
	RWApplyStyle(win, {
		position: "fixed",
		zIndex: "2147483000",
		background: "#10101c",
		border: "4px solid #ffffff",
		borderRadius: "12px",
		boxShadow: "0 8px 40px rgba(0,0,0,.65)",
		display: "flex",
		flexDirection: "column",
		overflow: "hidden",
		pointerEvents: "auto",
		userSelect: "none",
		touchAction: "none",
		fontFamily: "sans-serif",
		color: "#e8eaf6",
		fontSize: "13px",
		left: RWUI.geo.x + "px",
		top: RWUI.geo.y + "px",
		width: RWUI.geo.w + "px",
		height: RWUI.geo.h + "px",
	});

	
	const titlebar = document.createElement("div");
	titlebar.id = "rw-titlebar";
	RWApplyStyle(titlebar, {
		display: "flex",
		alignItems: "center",
		gap: "6px",
		padding: "8px 10px",
		background: "#1a1e30",
		borderBottom: "1px solid #2a2f45",
		cursor: "move",
		userSelect: "none",
		flex: "0 0 auto",
	});
	const title = document.createElement("span");
	title.id = "rw-title";
	RWApplyStyle(title, {
		flex: "1",
		color: "#ffd166",
		fontWeight: "bold",
		fontSize: "15px",
		whiteSpace: "nowrap",
		overflow: "hidden",
		textOverflow: "ellipsis",
	});
	title.textContent = RWT("title");
	const btnMin = document.createElement("button");
	btnMin.className = "rw-btn-title";
	RWApplyStyle(btnMin, {
		background: "transparent",
		border: "1px solid #4a5278",
		color: "#c5cbe8",
		borderRadius: "6px",
		width: "34px",
		height: "34px",
		fontSize: "20px",
		lineHeight: "1",
		cursor: "pointer",
		padding: "0",
	});
	btnMin.textContent = "—";
	btnMin.title = RWT("minimizeTitle");
	const btnClose = document.createElement("button");
	btnClose.className = "rw-btn-title";
	RWApplyStyle(btnClose, {
		background: "transparent",
		border: "1px solid #4a5278",
		color: "#c5cbe8",
		borderRadius: "6px",
		width: "34px",
		height: "34px",
		fontSize: "20px",
		lineHeight: "1",
		cursor: "pointer",
		padding: "0",
	});
	btnClose.textContent = "✕";
	btnClose.title = RWT("closeTitle");
	titlebar.appendChild(title);
	titlebar.appendChild(btnMin);
	titlebar.appendChild(btnClose);
	win.appendChild(titlebar);

	
	const toolbar = document.createElement("div");
	toolbar.id = "rw-toolbar";
	RWApplyStyle(toolbar, {
		display: "flex",
		flexWrap: "wrap",
		gap: "6px",
		padding: "8px",
		background: "#151727",
		borderBottom: "1px solid #2a2f45",
		flex: "0 0 auto",
	});
	win.appendChild(toolbar);

	
	const body = document.createElement("div");
	body.id = "rw-body";
	RWApplyStyle(body, {
		position: "relative",
		flex: "1 1 auto",
		minHeight: "0",
		overflow: "hidden",
	});
	const canvas = document.createElement("canvas");
	canvas.id = "rw-canvas";
	RWApplyStyle(canvas, {
		position: "absolute",
		left: "0px",
		top: "0px",
		display: "block",
		cursor: "default",
		touchAction: "none",
	});
	body.appendChild(canvas);
	const side = document.createElement("div");
	side.id = "rw-side";
	RWApplyStyle(side, {
		position: "absolute",
		left: "8px",
		top: "8px",
		bottom: "8px",
		width: "270px",
		maxWidth: "75%",
		overflowY: "auto",
		background: "rgba(18, 18, 32, 0.97)",
		border: "1px solid #5a6388",
		borderRadius: "8px",
		padding: "10px",
		color: "#e8eaf6",
		fontSize: "13px",
		zIndex: "2",
		boxSizing: "border-box",
		display: "none",
	});
	body.appendChild(side);
	const legend = document.createElement("div");
	legend.id = "rw-legend";
	RWApplyStyle(legend, {
		position: "absolute",
		right: "8px",
		top: "8px",
		background: "rgba(18, 18, 32, 0.92)",
		border: "1px solid #5a6388",
		borderRadius: "8px",
		padding: "6px 10px",
		color: "#9aa3c7",
		fontSize: "12px",
		lineHeight: "1.7",
		zIndex: "2",
		pointerEvents: "none",
		textAlign: "left",
	});
	body.appendChild(legend);

	
	const descPanel = document.createElement("div");
	descPanel.id = "rw-desc";
	RWApplyStyle(descPanel, {
		position: "absolute",
		right: "8px",
		top: "64px",
		bottom: "8px",
		width: "340px",
		maxWidth: "75%",
		display: "none",
		flexDirection: "column",
		background: "rgba(18, 18, 32, 0.97)",
		border: "1px solid #5a6388",
		borderRadius: "8px",
		padding: "10px",
		color: "#e8eaf6",
		fontSize: "13px",
		zIndex: "3",
		boxSizing: "border-box",
	});
	const descHeader = document.createElement("div");
	RWApplyStyle(descHeader, {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "8px",
		flex: "0 0 auto",
	});
	const descTitle = document.createElement("span");
	RWApplyStyle(descTitle, { color: "#ffd166", fontWeight: "bold", fontSize: "14px" });
	const descCloseBtn = document.createElement("button");
	descCloseBtn.className = "rw-btn-title";
	RWApplyStyle(descCloseBtn, {
		background: "transparent",
		border: "1px solid #4a5278",
		color: "#c5cbe8",
		borderRadius: "6px",
		width: "28px",
		height: "28px",
		fontSize: "16px",
		lineHeight: "1",
		cursor: "pointer",
		padding: "0",
		flex: "0 0 auto",
	});
	descCloseBtn.textContent = "✕";
	descCloseBtn.title = RWT("sideClose");
	descCloseBtn.addEventListener("click", () => RWUIDescClose());
	descHeader.appendChild(descTitle);
	descHeader.appendChild(descCloseBtn);
	descPanel.appendChild(descHeader);
	
	const descSwitcher = document.createElement("div");
	RWApplyStyle(descSwitcher, {
		display: "none",
		flexWrap: "wrap",
		gap: "6px",
		marginTop: "8px",
		flex: "0 0 auto",
	});
	descPanel.appendChild(descSwitcher);
	const descContent = document.createElement("div");
	RWApplyStyle(descContent, {
		flex: "1 1 auto",
		overflowY: "auto",
		marginTop: "8px",
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
		lineHeight: "1.6",
		color: "#e8eaf6",
		paddingRight: "4px",
	});
	descPanel.appendChild(descContent);
	body.appendChild(descPanel);
	const resizeHandle = document.createElement("div");
	resizeHandle.id = "rw-resize";
	RWApplyStyle(resizeHandle, {
		position: "absolute",
		right: "2px",
		bottom: "2px",
		width: "18px",
		height: "18px",
		cursor: "nwse-resize",
		zIndex: "3",
		borderRight: "2px solid #8891b8",
		borderBottom: "2px solid #8891b8",
		borderTopRightRadius: "0px",
	});
	resizeHandle.title = RWT("resizeTitle");
	body.appendChild(resizeHandle);
	win.appendChild(body);

	document.body.appendChild(win);

	RWUI.win = win;
	RWUI.titlebar = titlebar;
	RWUI.toolbar = toolbar;
	RWUI.body = body;
	RWUI.canvas = canvas;
	RWUI.ctx = canvas.getContext ? canvas.getContext("2d") : null;
	RWUI.side = side;
	RWUI.legend = legend;
	RWUI.resizeHandle = resizeHandle;
	RWUI.descPanel = descPanel;
	RWUI.descTitle = descTitle;
	RWUI.descContent = descContent;
	RWUI.descSwitcher = descSwitcher;
	RWUI.descButtons = null;
	RWUI.descPersonId = null;
	RWUI.descNum = null;

	
	titlebar.addEventListener("mousedown", (e) => {
		if (e.target.closest && e.target.closest("button")) return; 
		RWUI.winDrag = { dx: e.clientX - RWUI.geo.x, dy: e.clientY - RWUI.geo.y };
		e.preventDefault();
	});
	btnMin.addEventListener("mousedown", (e) => e.stopPropagation());
	btnMin.addEventListener("click", () => {
		RWUI.minimized = !RWUI.minimized;
		toolbar.style.display = RWUI.minimized ? "none" : "";
		body.style.display = RWUI.minimized ? "none" : "";
		resizeHandle.style.display = RWUI.minimized ? "none" : "";
		if (RWUI.minimized) {
			win.style.height = "auto";
		} else {
			win.style.height = RWUI.geo.h + "px";
			RWUIResizeCanvas();
		}
	});
	btnClose.addEventListener("mousedown", (e) => e.stopPropagation());
	btnClose.addEventListener("click", () => RelationWebClose());

	
	resizeHandle.addEventListener("mousedown", (e) => {
		RWUI.resDrag = { sx: e.clientX, sy: e.clientY, w: RWUI.geo.w, h: RWUI.geo.h };
		e.preventDefault();
		e.stopPropagation();
	});

	
	canvas.addEventListener("mousedown", (e) => {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left, my = e.clientY - rect.top;
		const hit = RWUINodeAt(mx, my);
		if (hit) {
			RWUI.drag = { id: hit, moved: false };
		} else {
			RWUI.pan = { sx: mx, sy: my, ox: RWUI.view.x, oy: RWUI.view.y, moved: false };
		}
		e.preventDefault();
	});
	canvas.addEventListener("mousemove", (e) => {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left, my = e.clientY - rect.top;
		if (RWUI.drag) {
			const nd = RWUI.nodes.get(RWUI.drag.id);
			if (nd) {
				const dx = mx - (RWUI.view.x + nd.x * RWUI.view.scale);
				const dy = my - (RWUI.view.y + nd.y * RWUI.view.scale);
				if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
					RWUI.drag.moved = true;
					nd.fixed = true;
					nd.x += dx / RWUI.view.scale;
					nd.y += dy / RWUI.view.scale;
					RWUI.needDraw = true;
				}
			}
		} else if (RWUI.pan) {
			const dx = mx - RWUI.pan.sx, dy = my - RWUI.pan.sy;
			if (Math.abs(dx) > 2 || Math.abs(dy) > 2) RWUI.pan.moved = true;
			RWUI.view.x = RWUI.pan.ox + dx;
			RWUI.view.y = RWUI.pan.oy + dy;
			RWUI.needDraw = true;
		} else {
			const hover = RWUINodeAt(mx, my);
			if (hover !== RWUI.hoverId) {
				RWUI.hoverId = hover;
				RWUI.needDraw = true;
			}
			canvas.style.cursor = RWUI.hoverId ? "pointer" : "default";
		}
	});
	canvas.addEventListener("mouseup", () => {
		
		const moved = (RWUI.drag && RWUI.drag.moved) || (RWUI.pan && RWUI.pan.moved);
		RWUI.suppressClick = !!moved;
		RWUI.drag = null;
		RWUI.pan = null;
	});
	canvas.addEventListener("click", (e) => {
		if (RWUI.suppressClick) {
			RWUI.suppressClick = false;
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left, my = e.clientY - rect.top;
		const hit = RWUINodeAt(mx, my);
		if (!hit) return;
		if (RWUI.mergeMode) {
			if (!RWUI.mergeFirstId) {
				RWUI.mergeFirstId = hit;
				RWToast(RWT("toastMergeFirst"));
			} else if (RWUI.mergeFirstId !== hit) {
				const pA = RWFindPersonById(RWUI.mergeFirstId);
				const pB = RWFindPersonById(hit);
				if (pA && pB) {
					const msg = RWT("confirmMerge",
						RWMainName(pA),
						RWMainName(pB),
						[...pA.nums, ...pB.nums].map(n => "#" + n).join(", "),
						RWUIRawEdgeBetween(pA.id, pB.id) ? RWT("confirmMergeWarn") : "");
					RWUIConfirm(msg).then(ok => {
						if (!ok) return;
						const merged = RWMergePersons(pA.id, pB.id);
						RWUI.selId = merged ? merged.id : null;
						RWUI.dirty = true;
						RWUISideBuild();
						RWToast(RWT("toastMerged", merged ? RWMainName(merged) : ""));
					});
				}
				RWUI.mergeMode = false;
				RWUI.mergeFirstId = null;
				RWUITopbarBuild();
			} else {
				RWUI.mergeFirstId = null;
				RWToast(RWT("toastMergeCancel"));
			}
		} else {
			RWUI.selId = hit;
			RWUISideBuild();
		}
	});
	canvas.addEventListener("wheel", (e) => {
		e.preventDefault();
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left, my = e.clientY - rect.top;
		const factor = e.deltaY < 0 ? 1.1 : 0.9;
		const oldScale = RWUI.view.scale;
		const newScale = Math.min(3, Math.max(0.25, oldScale * factor));
		
		const wx = (mx - RWUI.view.x) / oldScale;
		const wy = (my - RWUI.view.y) / oldScale;
		RWUI.view.scale = newScale;
		RWUI.view.x = mx - wx * newScale;
		RWUI.view.y = my - wy * newScale;
		RWUI.needDraw = true;
	}, { passive: false });
	canvas.addEventListener("contextmenu", (e) => e.preventDefault());

	
	const onDocMove = (e) => {
		if (RWUI.winDrag) {
			const vw = window.innerWidth || 1000, vh = window.innerHeight || 700;
			RWUI.geo.x = Math.min(Math.max(e.clientX - RWUI.winDrag.dx, 0), Math.max(0, vw - 60));
			RWUI.geo.y = Math.min(Math.max(e.clientY - RWUI.winDrag.dy, 0), Math.max(0, vh - 40));
			win.style.left = RWUI.geo.x + "px";
			win.style.top = RWUI.geo.y + "px";
		} else if (RWUI.resDrag) {
			const vw = window.innerWidth || 1000, vh = window.innerHeight || 700;
			RWUI.geo.w = Math.min(Math.max(RWUI.resDrag.w + (e.clientX - RWUI.resDrag.sx), 320), vw - 10);
			RWUI.geo.h = Math.min(Math.max(RWUI.resDrag.h + (e.clientY - RWUI.resDrag.sy), 240), vh - 10);
			win.style.width = RWUI.geo.w + "px";
			win.style.height = RWUI.geo.h + "px";
			RWUIResizeCanvas();
		}
	};
	const onDocUp = () => {
		if (RWUI.winDrag || RWUI.resDrag) {
			RWUI.winDrag = null;
			RWUI.resDrag = null;
			RWUIGeoSave();
		}
	};
	document.addEventListener("mousemove", onDocMove);
	document.addEventListener("mouseup", onDocUp);
	RWUI._docHandlers = { onDocMove, onDocUp };

	
	RWUI.escHandler = (e) => {
		if (e.key === "Escape" && RWUI.open) {
			const t = e.target;
			if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
			e.stopPropagation();
			e.preventDefault();
			RelationWebClose();
		}
	};
	document.addEventListener("keydown", RWUI.escHandler, true);

	
	
	RWUI._winResize = () => {
		if (!RWUI.open) return;
		const vw = window.innerWidth || 1000, vh = window.innerHeight || 700;
		if (RWUI.geo.w > vw - 10) RWUI.geo.w = Math.max(320, vw - 10);
		if (RWUI.geo.h > vh - 10) RWUI.geo.h = Math.max(240, vh - 10);
		RWUI.geo.x = Math.min(RWUI.geo.x, Math.max(0, vw - RWUI.geo.w - 10));
		RWUI.geo.y = Math.min(RWUI.geo.y, Math.max(0, vh - RWUI.geo.h - 10));
		win.style.left = RWUI.geo.x + "px";
		win.style.top = RWUI.geo.y + "px";
		win.style.width = RWUI.geo.w + "px";
		win.style.height = RWUI.geo.h + "px";
		RWUIResizeCanvas();
		RWUIGeoSave();
	};
	window.addEventListener("resize", RWUI._winResize);

	RWUITopbarBuild();
	RWUILegendBuild();
	RWUI.selId = null;
	RWUI.dirty = true;

	
	const deferredInit = () => RWRaf(() => {
		if (!RWUI.open || !RWUI.canvas || !RWUI.body) return; 
		RWUIResizeCanvas();
		
		RWUIDraw();
	});
	deferredInit();
	
	RWCollectAll();
	RWToast(RWT("toastOpened", RWStore.load().persons.length, RWStore.load().edges.length));
}

function RWUIDestroyWindow() {
	if (RWUI._docHandlers) {
		document.removeEventListener("mousemove", RWUI._docHandlers.onDocMove);
		document.removeEventListener("mouseup", RWUI._docHandlers.onDocUp);
		RWUI._docHandlers = null;
	}
	if (RWUI.escHandler) {
		document.removeEventListener("keydown", RWUI.escHandler, true);
		RWUI.escHandler = null;
	}
	if (RWUI._winResize) {
		window.removeEventListener("resize", RWUI._winResize);
		RWUI._winResize = null;
	}
	if (RWUI.win) {
		RWUI.win.remove();
		RWUI.win = null;
	}
	RWUI.titlebar = null;
	RWUI.toolbar = null;
	RWUI.body = null;
	RWUI.canvas = null;
	RWUI.ctx = null;
	RWUI.side = null;
	RWUI.legend = null;
	RWUI.resizeHandle = null;
	RWUI.descPanel = null;
	RWUI.descTitle = null;
	RWUI.descContent = null;
	RWUI.descSwitcher = null;
	RWUI.descButtons = null;
	RWUI.descPersonId = null;
	RWUI.descNum = null;
	RWUI.selId = null;
	RWUI.mergeMode = false;
	RWUI.mergeFirstId = null;
	RWUI.drag = null;
	RWUI.pan = null;
	RWUI.winDrag = null;
	RWUI.resDrag = null;
}

 

function RelationWebOpen() {
	if (RWUI.open) {
		
		return;
	}
	try {
		RWUIBuildWindow();
		RWUI.open = true;
		RWUIStartLoop();
	} catch (e) {
		RWErr("浮窗构建失败", e);
		RWUIDestroyWindow();
		RWUI.open = false;
		RWToast(RWT("toastBuildFail"));
	}
}

function RelationWebClose() {
	RWUIStopLoop();
	RWUIGeoSave();
	RWUIDestroyWindow();
	RWUI.open = false;
}

function RelationWebToggle() {
	if (RWUI.open) RelationWebClose();
	else RelationWebOpen();
}

 

function RWUIStartLoop() {
	if (RWUI.loopId) return;
	RWUI.loopId = setInterval(() => {
		try {
			if (RWUI.minimized || !RWUI.ctx) return;
			
			if (RWUI.tick % 30 === 0) RWUIResizeCanvas();
			if (RWUI.phys && RWUI.nodes.size <= 800) {
				RWUI.tick++;
				const n = RWUI.nodes.size;
				if (n <= 250 || RWUI.tick % 3 === 0) {
					const moved1 = RWUIStepForces();
					const moved2 = RWUIStepForces();
					if (moved1 || moved2) RWUI.needDraw = true;
				}
			} else {
				RWUI.tick++;
			}
			
			if (RWUI.needDraw || RWUI.dirty) {
				RWUIDraw();
				RWUI.needDraw = false;
			}
		} catch (e) {   }
	}, 33);
}

function RWUIStopLoop() {
	if (RWUI.loopId) {
		clearInterval(RWUI.loopId);
		RWUI.loopId = null;
	}
}

function RWUIResizeCanvas() {
	const cv = RWUI.canvas, body = RWUI.body;
	if (!cv || !body) return false;
	
	const rect = body.getBoundingClientRect();
	const w = Math.max(2, Math.round(rect.width));
	const h = Math.max(2, Math.round(rect.height));
	
	if (rect.width < 2 || rect.height < 2) return false;
	if (w !== cv.width || h !== cv.height) {
		cv.width = w;
		cv.height = h;
		
		cv.style.width = w + "px";
		cv.style.height = h + "px";
		RWUI.dirty = true;
		RWUI.needDraw = true;
		return true;
	}
	return false;
}

 
function RWUIFitView(w, h) {
	if (!RWUI.nodes.size || w < 50 || h < 50) return;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const nd of RWUI.nodes.values()) {
		if (nd.x < minX) minX = nd.x;
		if (nd.x > maxX) maxX = nd.x;
		if (nd.y < minY) minY = nd.y;
		if (nd.y > maxY) maxY = nd.y;
	}
	const bw = Math.max(maxX - minX, 80), bh = Math.max(maxY - minY, 80);
	const scale = Math.min(1.5, Math.max(0.25, Math.min(w / (bw + 120), h / (bh + 160))));
	RWUI.view.scale = scale;
	const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
	RWUI.view.x = w / 2 - cx * scale;
	RWUI.view.y = h / 2 - cy * scale;
}

 

function RWUISelfId() {
	if (typeof Player === "undefined" || !Player) return null;
	const p = RWFindPersonByNum(Player.MemberNumber);
	return p ? p.id : null;
}

 
function RWUISearchMatch(p, q) {
	if (!p || !q) return false;
	const ql = q.toLowerCase();
	for (const num of p.nums) {
		if (String(num) === ql || String(num).includes(ql)) return true;
	}
	for (const name of Object.keys(p.names || {})) {
		if (name.toLowerCase().includes(ql)) return true;
	}
	for (const nick of Object.keys(p.nicknames || {})) {
		if (nick.toLowerCase().includes(ql)) return true;
	}
	return false;
}

 
function RWUIBfsSet(seedIds) {
	const s = RWStore.load();
	const visEdges = s.edges.filter(e => RWUI.show[e.kind]);
	const adj = new Map();
	for (const e of visEdges) {
		if (!adj.has(e.a)) adj.set(e.a, []);
		if (!adj.has(e.b)) adj.set(e.b, []);
		adj.get(e.a).push(e.b);
		adj.get(e.b).push(e.a);
	}
	const seen = new Set(seedIds);
	const queue = seedIds.slice();
	while (queue.length) {
		const cur = queue.shift();
		for (const nb of adj.get(cur) || []) {
			if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
		}
	}
	return seen;
}

 
function RWUIVisKey() {
	const s = RWStore.load();
	return [
		s.persons.length, s.edges.length,
		RWUI.searchText, RWUI.onlyRelated ? 1 : 0,
		RWUI.show.owner ? 1 : 0, RWUI.show.lover ? 1 : 0, RWUI.show.friend ? 1 : 0,
		RWUI.hiddenStamp, RWUI.hidden.size,
		RWUISelfId() || "-",
	].join("|");
}

function RWUIVisiblePersons() {
	const key = RWUIVisKey();
	if (RWUI.visPersons && RWUI.visKey === key) return RWUI.visPersons;
	RWUI.visKey = key;
	RWUI.visPersons = RWUIVisiblePersonsCompute();
	return RWUI.visPersons;
}

function RWUIVisiblePersonsCompute() {
	const s = RWStore.load();
	let result;
	const q = (RWUI.searchText || "").trim();
	if (q) {
		
		const matched = s.persons.filter(p => RWUISearchMatch(p, q));
		const seen = RWUIBfsSet(matched.map(p => p.id));
		result = s.persons.filter(p => seen.has(p.id));
	} else if (RWUI.onlyRelated) {
		const selfId = RWUISelfId();
		if (!selfId) {
			result = s.persons;
		} else {
			const seen = RWUIBfsSet([selfId]);
			result = s.persons.filter(p => seen.has(p.id));
		}
	} else {
		result = s.persons;
	}
	
	if (RWUI.hidden.size) {
		result = result.filter(p => !RWUI.hidden.has(p.id));
	}
	return result;
}

function RWUIVisibleEdges() {
	const key = RWUIVisKey();
	if (RWUI.visEdges && RWUI.visEdgesKey === key) return RWUI.visEdges;
	RWUIVisiblePersons(); 
	const s = RWStore.load();
	const visPersons = new Set(RWUI.visPersons.map(p => p.id));
	RWUI.visEdges = s.edges.filter(e => RWUI.show[e.kind] && visPersons.has(e.a) && visPersons.has(e.b));
	RWUI.visEdgesKey = key;
	return RWUI.visEdges;
}

 
function RWUIRebuildNodes() {
	const persons = RWUIVisiblePersons();
	const old = RWUI.nodes;
	const next = new Map();
	const n = persons.length;
	const R = Math.max(60, Math.sqrt(n) * 55);
	let i = 0;
	for (const p of persons) {
		const kept = old.get(p.id);
		if (kept) {
			next.set(p.id, kept);
		} else {
			const ang = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
			next.set(p.id, {
				x: Math.cos(ang) * R + (Math.random() * 20 - 10),
				y: Math.sin(ang) * R + (Math.random() * 20 - 10),
				vx: 0, vy: 0, fixed: false,
			});
		}
		i++;
	}
	RWUI.nodes = next;
	RWUI.dirty = false;
}

 
function RWUIStepForces() {
	const nodes = Array.from(RWUI.nodes.entries()).map(([id, nd]) => ({ id, ...nd }));
	if (nodes.length === 0) return false;
	let moved = false;
	
	const adj = new Map();
	for (const e of RWUIVisibleEdges()) {
		if (!adj.has(e.a)) adj.set(e.a, []);
		if (!adj.has(e.b)) adj.set(e.b, []);
		adj.get(e.a).push(e.b);
		adj.get(e.b).push(e.a);
	}
	const K_REP = 9000, SPRING = 150, K_SPRING = 0.015, GRAV = 0.002, DAMP = 0.85;

	for (let i = 0; i < nodes.length; i++) {
		const a = nodes[i];
		if (a.fixed) continue;
		let fx = 0, fy = 0;
		
		for (let j = 0; j < nodes.length; j++) {
			if (i === j) continue;
			const b = nodes[j];
			const dx = a.x - b.x, dy = a.y - b.y;
			let d2 = dx * dx + dy * dy;
			if (d2 < 1) d2 = 1;
			const f = Math.min(K_REP / d2, 60);
			const d = Math.sqrt(d2);
			fx += (dx / d) * f;
			fy += (dy / d) * f;
		}
		
		for (const oid of adj.get(a.id) || []) {
			const b = nodes.find(nd => nd.id === oid);
			if (!b) continue;
			const dx = b.x - a.x, dy = b.y - a.y;
			const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
			const f = (d - SPRING) * K_SPRING;
			fx += (dx / d) * f;
			fy += (dy / d) * f;
		}
		
		fx -= a.x * GRAV;
		fy -= a.y * GRAV;
		a.vx = (a.vx + fx) * DAMP;
		a.vy = (a.vy + fy) * DAMP;
		a.x += a.vx;
		a.y += a.vy;
		if (Math.abs(a.vx) > 0.05 || Math.abs(a.vy) > 0.05) moved = true;
	}

	
	for (const nd of nodes) {
		const kept = RWUI.nodes.get(nd.id);
		if (kept) {
			kept.x = nd.x; kept.y = nd.y; kept.vx = nd.vx; kept.vy = nd.vy;
		}
	}
	return moved;
}

const RWUIEdgeKinds = {
	owner: { color: "#ff5566", label: "主人", dash: [] },
	lover: { color: "#ff9de2", label: "恋人", dash: [8, 6] },
	friend: { color: "#6db3ff", label: "好友", dash: [] },
};

function RWUIToScreen(wx, wy) {
	return {
		x: RWUI.view.x + wx * RWUI.view.scale,
		y: RWUI.view.y + wy * RWUI.view.scale,
	};
}

function RWUIDraw() {
	const cv = RWUI.canvas, ctx = RWUI.ctx;
	if (!cv || !ctx || !cv.width || !cv.height) return;
	const w = cv.width, h = cv.height;
	ctx.clearRect(0, 0, w, h);

	
	ctx.save();
	ctx.fillStyle = "rgba(10, 10, 18, 0.92)";
	ctx.fillRect(0, 0, w, h);
	ctx.strokeStyle = "rgba(255,255,255,0.05)";
	ctx.lineWidth = 1;
	const grid = 60;
	const ox = RWUI.view.x % grid, oy = RWUI.view.y % grid;
	ctx.beginPath();
	for (let x = ox; x < w; x += grid) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
	for (let y = oy; y < h; y += grid) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
	ctx.stroke();
	ctx.restore();

	if (RWUI.dirty) {
		RWUIRebuildNodes();
		
		if (!RWUI.viewInit) {
			RWUIFitView(w, h);
			RWUI.viewInit = true;
		}
	}
	
	if (RWUI.pendingCenter) {
		const nd = RWUI.nodes.get(RWUI.pendingCenter);
		if (nd) {
			RWUI.view.x = w / 2 - nd.x * RWUI.view.scale;
			RWUI.view.y = h / 2 - nd.y * RWUI.view.scale;
		}
		RWUI.pendingCenter = null;
	}
	const selfId = RWUISelfId();
	const visEdges = RWUIVisibleEdges();

	
	const inOwner = new Set();   
	const inLover = new Set();
	for (const e of RWStore.load().edges) {
		if (e.kind === "owner" && RWUI.show.owner) inOwner.add(e.b);
		if (e.kind === "lover" && RWUI.show.lover) { inLover.add(e.a); inLover.add(e.b); }
	}

	
	const pairMap = new Map();
	const kindOrder = ["owner", "lover", "friend"];
	for (const e of visEdges) {
		const key = e.a < e.b ? e.a + "|" + e.b : e.b + "|" + e.a;
		if (!pairMap.has(key)) pairMap.set(key, []);
		pairMap.get(key).push(e);
	}

	for (const e of visEdges) {
		const na = RWUI.nodes.get(e.a), nb = RWUI.nodes.get(e.b);
		if (!na || !nb) continue;
		const pa = RWUIToScreen(na.x, na.y), pb = RWUIToScreen(nb.x, nb.y);
		const style = RWUIEdgeKinds[e.kind] || RWUIEdgeKinds.friend;
		const key = e.a < e.b ? e.a + "|" + e.b : e.b + "|" + e.a;
		const group = pairMap.get(key) || [e];
		const gi = kindOrder.indexOf(e.kind);
		
		const off = group.length > 1 ? (gi - (kindOrder.length - 1) / 2) * 9 : 0;
		const dx = pb.x - pa.x, dy = pb.y - pa.y;
		const len = Math.hypot(dx, dy) || 1;
		const px = (-dy / len) * off * RWUI.view.scale;
		const py = (dx / len) * off * RWUI.view.scale;
		const a1 = { x: pa.x + px, y: pa.y + py };
		const b1 = { x: pb.x + px, y: pb.y + py };

		ctx.save();
		
		ctx.strokeStyle = "rgba(0,0,0,0.6)";
		ctx.lineWidth = 5;
		ctx.globalAlpha = 1;
		ctx.setLineDash([]);
		ctx.beginPath();
		ctx.moveTo(a1.x, a1.y);
		ctx.lineTo(b1.x, b1.y);
		ctx.stroke();
		
		ctx.strokeStyle = style.color;
		ctx.globalAlpha = e.last > RWNow() - 86400000 ? 0.95 : 0.55; 
		ctx.lineWidth = 2.6;
		ctx.setLineDash(style.dash || []);
		ctx.beginPath();
		ctx.moveTo(a1.x, a1.y);
		ctx.lineTo(b1.x, b1.y);
		ctx.stroke();
		
		if (e.kind === "owner") {
			const ang = Math.atan2(b1.y - a1.y, b1.x - a1.x);
			const r = 17 * RWUI.view.scale;
			const tipX = b1.x - Math.cos(ang) * r, tipY = b1.y - Math.sin(ang) * r;
			ctx.setLineDash([]);
			ctx.lineWidth = 2.6;
			ctx.beginPath();
			ctx.moveTo(tipX, tipY);
			ctx.lineTo(tipX - 11 * Math.cos(ang - 0.45), tipY - 11 * Math.sin(ang - 0.45));
			ctx.moveTo(tipX, tipY);
			ctx.lineTo(tipX - 11 * Math.cos(ang + 0.45), tipY - 11 * Math.sin(ang + 0.45));
			ctx.stroke();
		}
		ctx.restore();
	}

	
	const s = RWStore.load();
	for (const p of s.persons) {
		const nd = RWUI.nodes.get(p.id);
		if (!nd) continue;
		const pos = RWUIToScreen(nd.x, nd.y);
		const r = 14 * RWUI.view.scale;
		ctx.save();
		ctx.beginPath();
		ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
		ctx.fillStyle = p.id === selfId ? "#ffd166" : (p.ownsOwnAlt ? "#7a5c2e" : "#3a3f55");
		ctx.fill();
		ctx.lineWidth = 3;
		if (inOwner.has(p.id)) ctx.strokeStyle = "#ff5566";
		else if (inLover.has(p.id)) ctx.strokeStyle = "#ff9de2";
		else ctx.strokeStyle = "#8891b8";
		ctx.stroke();
		
		if (p.id === RWUI.selId || p.id === RWUI.mergeFirstId) {
			ctx.beginPath();
			ctx.arc(pos.x, pos.y, r + 5 * RWUI.view.scale, 0, Math.PI * 2);
			ctx.strokeStyle = p.id === RWUI.mergeFirstId ? "#ffd166" : "#ffffff";
			ctx.lineWidth = 2;
			ctx.stroke();
		}
		if (p.id === RWUI.hoverId) {
			ctx.beginPath();
			ctx.arc(pos.x, pos.y, r + 3 * RWUI.view.scale, 0, Math.PI * 2);
			ctx.strokeStyle = "rgba(255,255,255,0.6)";
			ctx.lineWidth = 1.5;
			ctx.stroke();
		}
		ctx.restore();

		
		const name = RWMainDisplayName(p);
		const extra = [];
		if (p.nums.length > 1) extra.push(RWT("nodeAccts", p.nums.length));
		if (p.ownsOwnAlt) extra.push(RWT("nodeOwnAlt"));
		if (p.note) extra.push("📝");
		const label = name;
		const sub = extra.join(" · ");
		ctx.save();
		ctx.font = (13 * RWUI.view.scale) + "px sans-serif";
		ctx.textAlign = "center";
		ctx.fillStyle = p.id === selfId ? "#ffd166" : "#e8eaf6";
		ctx.fillText(label, pos.x, pos.y - r - 6 * RWUI.view.scale);
		if (sub) {
			ctx.font = (11 * RWUI.view.scale) + "px sans-serif";
			ctx.fillStyle = "#9aa3c7";
			ctx.fillText(sub, pos.x, pos.y + r + 14 * RWUI.view.scale);
		}
		ctx.restore();
	}

	
	if (RWUI.mergeMode) {
		ctx.save();
		ctx.font = "15px sans-serif";
		ctx.textAlign = "center";
		ctx.fillStyle = "#ffd166";
		const msg = RWUI.mergeFirstId
			? RWT("hintMergePick2")
			: RWT("hintMergePick1");
		ctx.fillText(msg, w / 2, 24);
		ctx.restore();
	}
}

function RWUINodeAt(x, y) {
	let best = null, bestDist = Infinity;
	for (const [id, nd] of RWUI.nodes) {
		const pos = RWUIToScreen(nd.x, nd.y);
		const d = Math.hypot(pos.x - x, pos.y - y);
		const hit = Math.max(16 * RWUI.view.scale, 14);
		if (d < hit && d < bestDist) { best = id; bestDist = d; }
	}
	return best;
}

 

function RWUILegendBuild() {
	const L = RWUI.legend;
	if (!L) return;
	
	L.innerHTML =
		"<span style='color:#ffd166'>" + RWT("legendSelf") + "</span> · " + RWT("legendOwned") + " · " +
		"<span style='color:#ff5566'>——</span> " + RWT("edgeOwner") +
		" · <span style='color:#ff9de2'>--</span> " + RWT("edgeLover") +
		" · <span style='color:#6db3ff'>——</span> " + RWT("edgeFriend") + "<br>" +
		RWT("legendTips") + " · " + RWT("legendCmd");
}

 

 
function RWPersonBioLen(p) {
	if (!p) return 0;
	let n = (p.desc || "").length;
	if (p.numDescs) {
		for (const d of Object.values(p.numDescs)) {
			if (typeof d === "string" && d.length > n) n = d.length;
		}
	}
	return n;
}

 
function RWUIDescSelectNum(num) {
	const p = RWUI.descPersonId ? RWFindPersonById(RWUI.descPersonId) : null;
	if (!p || !RWUI.descPanel) return;
	RWUI.descNum = num;
	const acctLabel = (n) => {
		const nm = p.numNames && p.numNames[n];
		return (typeof nm === "string" && nm) ? (nm + " #" + n) : ("#" + n);
	};
	RWUI.descTitle.textContent = (num == null)
		? RWT("descPanelTitle", RWMainName(p))
		: RWT("descPanelTitle", RWMainName(p)) + " · " + acctLabel(num);
	RWUI.descContent.textContent = (num == null)
		? (p.desc || "")
		: (p.numDescs && typeof p.numDescs[num] === "string" && p.numDescs[num]) || RWT("descNoBio");
	
	for (const item of (RWUI.descButtons || [])) {
		const active = (num == null && item.num == null) || (num != null && item.num === num);
		RWApplyStyle(item.btn, {
			background: active ? "#8a6d1a" : "#2a2f45",
			border: "1px solid " + (active ? "#ffd166" : "#4a5278"),
		});
	}
}

function RWUIDescOpen(personId) {
	const p = RWFindPersonById(personId);
	if (!p || !RWUI.descPanel) return;
	if (RWPersonBioLen(p) === 0) return;
	RWUI.descPersonId = p.id;
	RWUI.descNum = null;
	
	RWUI.descButtons = [];
	const sw = RWUI.descSwitcher;
	if (sw) {
		sw.innerHTML = "";
		if ((p.nums || []).length > 1) {
			sw.style.display = "flex";
			const mk = (label, num) => {
				const b = document.createElement("button");
				b.className = "rw-btn-mini";
				b._rwNum = num;
				RWApplyStyle(b, {
					background: "#2a2f45", border: "1px solid #4a5278", color: "#e8eaf6",
					borderRadius: "6px", padding: "4px 10px", fontSize: "12px", cursor: "pointer",
				});
				b.textContent = label;
				b.addEventListener("click", () => RWUIDescSelectNum(num));
				sw.appendChild(b);
				RWUI.descButtons.push({ btn: b, num });
			};
			mk(RWT("descDefaultTab"), null);
			for (const num of p.nums) {
				const nm = p.numNames && p.numNames[num];
				mk((typeof nm === "string" && nm) ? nm : ("#" + num), num);
			}
		} else {
			sw.style.display = "none";
		}
	}
	RWUIDescSelectNum(null);
	RWUI.descPanel.style.display = "flex";
}

function RWUIDescClose() {
	RWUI.descPersonId = null;
	RWUI.descNum = null;
	if (RWUI.descPanel) RWUI.descPanel.style.display = "none";
}

 

function RWUITwoStep(btn, confirmLabel, action) {
	if (!btn) return;
	let armed = false;
	let timer = null;
	btn._rwBaseLabel = btn.textContent;
	const disarm = () => {
		armed = false;
		if (timer) { clearTimeout(timer); timer = null; }
		btn.textContent = btn._rwBaseLabel;
		RWApplyStyle(btn, { background: "#5c2030", border: "1px solid #ff5566" });
	};
	btn.addEventListener("click", () => {
		if (!armed) {
			armed = true;
			btn.textContent = confirmLabel;
			RWApplyStyle(btn, { background: "#a0273a", border: "2px solid #ff8a9a" });
			timer = setTimeout(disarm, 4000);
		} else {
			disarm();
			action();
		}
	});
}

 

let RWUIConfirmActive = false;

function RWUIConfirm(message, opts) {
	return new Promise((resolve) => {
		if (!RWUI.body || RWUIConfirmActive) { resolve(false); return; }
		RWUIConfirmActive = true;

		const ov = document.createElement("div");
		RWApplyStyle(ov, {
			position: "absolute", left: "0", top: "0", right: "0", bottom: "0",
			background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center",
			justifyContent: "center", zIndex: "20",
		});
		const box = document.createElement("div");
		RWApplyStyle(box, {
			background: "#161827", border: "2px solid #ffffff", borderRadius: "12px",
			padding: "16px 18px", maxWidth: "440px", width: "82%",
			boxShadow: "0 8px 40px rgba(0,0,0,.7)", display: "flex", flexDirection: "column", gap: "14px",
		});
		const msg = document.createElement("div");
		RWApplyStyle(msg, {
			color: "#e8eaf6", fontSize: "15px", lineHeight: "1.6", whiteSpace: "pre-wrap",
			wordBreak: "break-word", maxHeight: "260px", overflowY: "auto",
		});
		msg.textContent = message;
		box.appendChild(msg);
		const btns = document.createElement("div");
		RWApplyStyle(btns, { display: "flex", justifyContent: "flex-end", gap: "10px" });
		const mk = (label, danger, cb) => {
			const b = document.createElement("button");
			RWApplyStyle(b, {
				background: danger ? "#5c2030" : "#2a2f45",
				border: "1px solid " + (danger ? "#ff5566" : "#4a5278"),
				color: "#e8eaf6", borderRadius: "8px", padding: "7px 16px",
				fontSize: "16px", cursor: "pointer",
			});
			b.textContent = label;
			b.addEventListener("click", cb);
			return b;
		};
		const done = (val) => { ov.remove(); RWUIConfirmActive = false; resolve(val); };
		btns.appendChild(mk(RWT("btnCancel"), false, () => done(false)));
		btns.appendChild(mk(RWT("btnConfirm"), !!(opts && opts.danger), () => done(true)));
		box.appendChild(btns);
		ov.appendChild(box);
		RWUI.body.appendChild(ov);
	});
}

 

function RWDoImport(text) {
	try {
		const res = RWImportJSON(text);
		RWUI.dirty = true;
		RWUISideBuild();
		RWToast(RWT("toastImportDone", res.addedPersons, res.addedEdges));
	} catch (err) {
		const known = { jsonParse: RWT("errJsonParse"), notValid: RWT("errNotValid") };
		const msg = (err && known[err.rwCode]) || (err && err.message) || "?";
		RWToast(RWT("toastImportFail", msg));
	}
}

function RWUIImportDialog() {
	if (!RWUI.body || RWUIConfirmActive) return;
	RWUIConfirmActive = true;

	const ov = document.createElement("div");
	RWApplyStyle(ov, {
		position: "absolute", left: "0", top: "0", right: "0", bottom: "0",
		background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center",
		justifyContent: "center", zIndex: "20",
	});
	const box = document.createElement("div");
	RWApplyStyle(box, {
		background: "#161827", border: "2px solid #ffffff", borderRadius: "12px",
		padding: "16px 18px", maxWidth: "460px", width: "84%",
		boxShadow: "0 8px 40px rgba(0,0,0,.7)", display: "flex", flexDirection: "column", gap: "14px",
	});
	const msg = document.createElement("div");
	RWApplyStyle(msg, { color: "#e8eaf6", fontSize: "15px", lineHeight: "1.7", whiteSpace: "pre-wrap", wordBreak: "break-word" });
	msg.textContent = RWT("importDialogMsg");
	box.appendChild(msg);
	const btns = document.createElement("div");
	RWApplyStyle(btns, { display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" });
	const mk = (label, danger, cb) => {
		const b = document.createElement("button");
		RWApplyStyle(b, {
			background: danger ? "#5c2030" : "#2a2f45",
			border: "1px solid " + (danger ? "#ff5566" : "#4a5278"),
			color: "#e8eaf6", borderRadius: "8px", padding: "7px 16px",
			fontSize: "16px", cursor: "pointer",
		});
		b.textContent = label;
		b.addEventListener("click", cb);
		return b;
	};
	const cleanup = () => { ov.remove(); RWUIConfirmActive = false; };

	
	const fileInput = document.createElement("input");
	fileInput.type = "file";
	fileInput.accept = ".txt,.json";
	RWApplyStyle(fileInput, { display: "none" });
	ov.appendChild(fileInput);
	fileInput.addEventListener("change", () => {
		const f = fileInput.files && fileInput.files[0];
		if (!f) { cleanup(); RWToast(RWT("toastImportNoFile")); return; }
		const reader = new FileReader();
		reader.onload = () => { cleanup(); RWDoImport(String(reader.result || "")); };
		reader.onerror = () => { cleanup(); RWToast(RWT("toastImportFileFail", "FileReader error")); };
		reader.readAsText(f);
	});

	btns.appendChild(mk(RWT("importBtnFile"), false, () => fileInput.click()));
	btns.appendChild(mk(RWT("importBtnClip"), false, () => {
		if (navigator.clipboard && navigator.clipboard.readText) {
			navigator.clipboard.readText().then((t) => { cleanup(); RWDoImport(t); }, () => {
				cleanup(); RWToast(RWT("toastClipboardNo"));
			});
		} else {
			cleanup(); RWToast(RWT("toastClipboardNo"));
		}
	}));
	btns.appendChild(mk(RWT("btnCancel"), false, cleanup));
	box.appendChild(btns);
	ov.appendChild(box);
	RWUI.body.appendChild(ov);
}

 

function RWUISideBuild() {
	const side = RWUI.side;
	if (!side) return;
	side.innerHTML = "";
	const p = RWFindPersonById(RWUI.selId);
	if (!p) {
		side.style.display = "none";
		return;
	}
	side.style.display = "block";
	const el = (tag, cls, text) => {
		const e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text !== undefined) e.textContent = text;
		
		const clsStyles = {
			"rw-side-title": { color: "#ffd166", fontWeight: "bold", fontSize: "16px", marginBottom: "8px" },
			"rw-side-label": { color: "#9aa3c7", fontSize: "12px", marginTop: "10px", marginBottom: "4px" },
			"rw-side-info": { color: "#c5cbe8", marginBottom: "6px", wordBreak: "break-all" },
			"rw-side-numrow": { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0", color: "#ffd166" },
			"rw-side-relrow": { display: "flex", alignItems: "center", gap: "8px", padding: "4px 0", color: "#e8eaf6" },
			"rw-side-reldate": { marginLeft: "auto", color: "#6d7699", fontSize: "11px" },
			"rw-side-empty": { color: "#6d7699", fontStyle: "italic" },
			"rw-side-btns": { display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" },
			"rw-btn": {
				background: "#2a2f45", color: "#e8eaf6", border: "1px solid #4a5278",
				borderRadius: "8px", padding: "6px 12px", fontSize: "17px", cursor: "pointer", userSelect: "none",
			},
			"rw-btn-mini": { padding: "3px 10px", fontSize: "16px", marginLeft: "8px", background: "#2a2f45", color: "#e8eaf6", border: "1px solid #4a5278", borderRadius: "6px", cursor: "pointer" },
			"rw-btn-danger": { background: "#5c2030", border: "1px solid #ff5566", color: "#e8eaf6", borderRadius: "8px", padding: "6px 12px", fontSize: "17px", cursor: "pointer" },
		};
		if (cls) {
			const styles = clsStyles[cls];
			if (styles) RWApplyStyle(e, styles);
		}
		return e;
	};

	
	const isSelf = p.id === RWUISelfId();
	const header = el("div", "rw-side-btns");
	RWApplyStyle(header, { alignItems: "center", justifyContent: "space-between", marginBottom: "6px", gap: "8px" });
	const displayName = RWMainDisplayName(p);
	const titleEl = el("div", "rw-side-title", displayName);
	RWApplyStyle(titleEl, { flex: "1", marginBottom: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
	header.appendChild(titleEl);
	if (!isSelf) {
		const delBtn = el("button", "rw-btn", RWT("sideDelete"));
		RWApplyStyle(delBtn, {
			background: "#5c2030", border: "1px solid #ff5566", color: "#e8eaf6",
			borderRadius: "8px", padding: "6px 12px", fontSize: "16px", cursor: "pointer", flex: "0 0 auto",
		});
		RWUITwoStep(delBtn, RWT("twoStepConfirm"), () => {
			RWDeletePerson(p.id);
			RWUI.selId = null;
			RWUI.dirty = true;
			RWUISideBuild();
		});
		header.appendChild(delBtn);
		
		const hideBtn = el("button", "rw-btn", RWT("sideHide"));
		RWApplyStyle(hideBtn, {
			background: "#2a2f45", border: "1px solid #4a5278", color: "#e8eaf6",
			borderRadius: "8px", padding: "6px 12px", fontSize: "16px", cursor: "pointer", flex: "0 0 auto",
		});
		hideBtn.title = RWT("sideHideTitle");
		hideBtn.addEventListener("click", () => {
			RWUI.hidden.add(p.id);
			RWUI.hiddenStamp++;
			RWUI.selId = null;
			RWUI.dirty = true;
			RWUITopbarBuild();
			RWUISideBuild();
			RWToast(RWT("toastHidden", displayName));
		});
		header.appendChild(hideBtn);
	}
	const closeBtn = el("button", "rw-btn", "✕");
	RWApplyStyle(closeBtn, {
		background: "transparent", border: "1px solid #4a5278", color: "#c5cbe8",
		borderRadius: "6px", width: "30px", height: "30px", fontSize: "16px", cursor: "pointer",
		flex: "0 0 auto", padding: "0",
	});
	closeBtn.title = RWT("sideClose");
	closeBtn.addEventListener("click", () => { RWUI.selId = null; RWUISideBuild(); });
	header.appendChild(closeBtn);
	side.appendChild(header);

	
	const mainName = RWMainName(p);
	const hasNick = Object.keys(p.nicknames || {}).length > 0;
	if (hasNick && mainName && mainName !== displayName && !mainName.startsWith("#")) {
		side.appendChild(el("div", "rw-side-info", RWT("sideNameLabel", mainName)));
	}

	
	const numsBox = el("div", "rw-side-nums");
	for (const num of p.nums) {
		const row = el("div", "rw-side-numrow");
		row.appendChild(el("span", "", RWT("sideAccount", num) + (isSelf && p.nums.length === 1 ? RWT("sideMe") : "")));
		if (p.nums.length > 1 && !(isSelf && num === (typeof Player !== "undefined" && Player ? Player.MemberNumber : -1))) {
			const btn = el("button", "rw-btn rw-btn-mini", RWT("sideUnmerge"));
			btn.title = RWT("sideUnmergeTitle");
			btn.addEventListener("click", () => {
				RWUIConfirm(RWT("confirmUnmerge", num)).then(ok => {
					if (!ok) return;
					RWUnmergeNum(p.id, num);
					RWUI.dirty = true;
					RWUISideBuild();
				});
			});
			row.appendChild(btn);
		}
		numsBox.appendChild(row);
	}
	side.appendChild(numsBox);

	if (p.title) side.appendChild(el("div", "rw-side-info", RWT("sideTitleLabel", p.title)));
	
	const bioPreview = p.desc || (() => {
		for (const d of Object.values(p.numDescs || {})) if (typeof d === "string" && d) return d;
		return "";
	})();
	if (bioPreview) {
		side.appendChild(el("div", "rw-side-info", RWT("sideDescLabel", bioPreview.slice(0, 80) + (bioPreview.length > 80 ? "…" : ""))));
		const descBtn = el("button", "rw-btn-mini", RWT("descBtn"));
		descBtn.title = RWT((p.nums || []).length > 1 ? "descBtnTitleMulti" : "descBtnTitle", RWPersonBioLen(p));
		descBtn.addEventListener("click", () => RWUIDescOpen(p.id));
		const row = el("div", "rw-side-btns");
		row.appendChild(descBtn);
		side.appendChild(row);
	}

	
	side.appendChild(el("div", "rw-side-label", RWT("sideNoteLabel")));
	const note = document.createElement("textarea");
	note.className = "rw-side-note";
	RWApplyStyle(note, {
		width: "100%",
		height: "64px",
		background: "#1a1e30",
		color: "#e8eaf6",
		border: "1px solid #4a5278",
		borderRadius: "6px",
		padding: "6px",
		fontSize: "13px",
		resize: "vertical",
		boxSizing: "border-box",
	});
	note.value = p.note || "";
	note.placeholder = RWT("sideNotePh");
	note.addEventListener("change", () => {
		p.note = note.value;
		RWStore.requestSave();
		RWToast(RWT("toastNoteSaved"));
	});
	side.appendChild(note);

	
	const s = RWStore.load();
	const rels = s.edges.filter(e => e.a === p.id || e.b === p.id);
	if (rels.length) {
		side.appendChild(el("div", "rw-side-label", RWT("sideRelsLabel", rels.length)));
		for (const e of rels) {
			const otherId = e.a === p.id ? e.b : e.a;
			const other = RWFindPersonById(otherId);
			const otherName = other ? RWMainName(other) : "?";
			const style = RWUIEdgeKinds[e.kind];
			const row = el("div", "rw-side-relrow");
			const dot = el("span", "rw-side-reldot");
			dot.style.background = style.color;
			row.appendChild(dot);
			let desc;
			if (e.kind === "owner") {
				
				
				if (e.a === p.id) {
					desc = RWT(isSelf ? "sideOwnedSelf" : "sideOwnedOther", otherName);
				} else {
					desc = RWT(isSelf ? "sideOwnerSelf" : "sideOwnerOther", otherName);
				}
			} else if (e.kind === "lover") {
				desc = RWT("sideLover", otherName);
			} else {
				desc = RWT("sideFriend", otherName);
			}
			row.appendChild(el("span", "", desc));
			row.appendChild(el("span", "rw-side-reldate", new Date(e.last).toLocaleDateString(RWUI.lang === "zh" ? "zh-CN" : "en-US")));
			side.appendChild(row);
		}
	} else {
		side.appendChild(el("div", "rw-side-empty", RWT("sideNoRels")));
	}
}

 

function RWUITopbarBuild() {
	const bar = RWUI.toolbar;
	if (!bar) return;
	bar.innerHTML = "";
	const mkBtn = (text, title, onClick, active) => {
		const b = document.createElement("button");
		b.className = "rw-btn";
		RWApplyStyle(b, {
			background: active ? "#8a6d1a" : "#2a2f45",
			border: "1px solid " + (active ? "#ffd166" : "#4a5278"),
			color: "#e8eaf6",
			borderRadius: "8px",
			padding: "7px 14px",
			fontSize: "18px",
			cursor: "pointer",
			lineHeight: "1.3",
			userSelect: "none",
		});
		b.textContent = text;
		b.title = title || "";
		b.addEventListener("click", onClick);
		return b;
	};

	bar.appendChild(mkBtn(RWT("btnRefresh"), RWT("btnRefreshTitle"), () => {
		RWCollectAll();
		RWUI.dirty = true;
		RWUISideBuild();
		RWToast(RWT("toastRefreshed", RWStore.load().persons.length, RWStore.load().edges.length));
	}));
	bar.appendChild(mkBtn(RWUI.mergeMode ? RWT("btnMergeOn") : RWT("btnMerge"), RWT("btnMergeTitle"), () => {
		RWUI.mergeMode = !RWUI.mergeMode;
		RWUI.mergeFirstId = null;
		RWUITopbarBuild();
	}, RWUI.mergeMode));
	
	const searchWrap = document.createElement("span");
	RWApplyStyle(searchWrap, { display: "inline-flex", alignItems: "center", gap: "4px" });
	const searchInput = document.createElement("input");
	searchInput.type = "search";
	searchInput.value = RWUI.searchText;
	searchInput.placeholder = RWT("searchPh");
	RWApplyStyle(searchInput, {
		width: "150px", background: "#1a1e30", color: "#e8eaf6",
		border: "1px solid #4a5278", borderRadius: "8px", padding: "6px 10px",
		fontSize: "16px", outline: "none",
	});
	searchInput.addEventListener("input", () => {
		RWUI.searchText = searchInput.value;
		RWUI.dirty = true;
		const q = RWUI.searchText.trim();
		if (q) {
			
			const m = RWStore.load().persons.find(p => RWUISearchMatch(p, q) && !RWUI.hidden.has(p.id));
			RWUI.pendingCenter = m ? m.id : null;
		} else {
			RWUI.pendingCenter = null;
		}
	});
	const searchClear = document.createElement("button");
	RWApplyStyle(searchClear, {
		background: "transparent", border: "1px solid #4a5278", color: "#c5cbe8",
		borderRadius: "6px", width: "28px", height: "28px", fontSize: "14px", cursor: "pointer", padding: "0",
	});
	searchClear.textContent = "✕";
	searchClear.title = RWT("searchClearTitle");
	searchClear.addEventListener("click", () => {
		RWUI.searchText = "";
		searchInput.value = "";
		RWUI.pendingCenter = null;
		RWUI.dirty = true;
	});
	searchWrap.appendChild(searchInput);
	searchWrap.appendChild(searchClear);
	bar.appendChild(searchWrap);

	bar.appendChild(mkBtn(RWT("btnRelated"), RWT("btnRelatedTitle"), () => {
		RWUI.onlyRelated = !RWUI.onlyRelated;
		RWUI.dirty = true;
		RWUITopbarBuild();
	}, RWUI.onlyRelated));

	
	if (RWUI.hidden.size > 0) {
		bar.appendChild(mkBtn(RWT("btnUnhide", RWUI.hidden.size), RWT("btnUnhideTitle"), () => {
			RWUI.hidden.clear();
			RWUI.hiddenStamp++;
			RWUI.dirty = true;
			RWUITopbarBuild();
			RWToast(RWT("toastUnhidden"));
		}));
	}

	
	for (const kind of ["owner", "lover", "friend"]) {
		const label = RWT("edge" + kind.charAt(0).toUpperCase() + kind.slice(1));
		bar.appendChild(mkBtn((RWUI.show[kind] ? "✓ " : "✗ ") + RWT("btnEdge", label), RWT("btnEdgeTitle", label), () => {
			RWUI.show[kind] = !RWUI.show[kind];
			RWUITopbarBuild();
		}, RWUI.show[kind]));
	}

	bar.appendChild(mkBtn(RWUI.phys ? RWT("btnPhysAuto") : RWT("btnPhysManual"), RWT("btnPhysTitle"), () => {
		RWUI.phys = !RWUI.phys;
		RWUITopbarBuild();
	}, RWUI.phys));

	bar.appendChild(mkBtn(RWT("btnExport"), RWT("btnExportTitle"), () => RWUIExport()));
	bar.appendChild(mkBtn(RWT("btnImport"), RWT("btnImportTitle"), () => RWUIImport()));
	const clearBtn = mkBtn(RWT("btnClear"), RWT("btnClearTitle"), () => {   });
	RWApplyStyle(clearBtn, { background: "#5c2030", border: "1px solid #ff5566" });
	RWUITwoStep(clearBtn, RWT("twoStepConfirm"), () => {
		RWClearAll();
		RWUI.selId = null;
		RWUI.dirty = true;
		RWUISideBuild();
		RWToast(RWT("toastCleared"));
	});
	bar.appendChild(clearBtn);

	
	bar.appendChild(mkBtn(RWUI.lang === "zh" ? "EN" : "中文", RWT("btnLangTitle"), () => {
		RWUI.lang = RWUI.lang === "zh" ? "en" : "zh";
		try { RWStorage.set("RelationWebLang", RWUI.lang); } catch (e) {   }
		RWUITopbarBuild();
		RWUILegendBuild();
		RWUISideBuild();
		const t = RWUI.titlebar ? RWUI.titlebar.querySelector("#rw-title") : null;
		if (t) t.textContent = RWT("title");
		RWToast(RWT("toastLang"));
	}));
}

function RWUIExport() {
	try {
		const json = RWExportJSON();
		const done = (ok) => {
			if (ok) RWToast(RWT("toastExportClip"));
			else RWToast(RWT("toastExportFile"));
		};
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(json).then(() => done(true), () => done(false));
		} else {
			done(false);
		}
		
		const blob = new Blob([json], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "RelationWeb-backup-" + new Date().toISOString().slice(0, 10) + ".txt";
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
	} catch (e) {
		RWErr("导出失败", e);
		RWToast(RWT("toastExportFail", e.message));
	}
}

function RWUIImport() {
	
	RWUIImportDialog();
}

function RWToast(msg) {
	if (!RWUI.toastEl) {
		RWUI.toastEl = document.createElement("div");
		RWUI.toastEl.id = "rw-toast";
		RWApplyStyle(RWUI.toastEl, {
			position: "fixed",
			right: "16px",
			bottom: "16px",
			zIndex: "2147483600",
			background: "#2a2f45",
			border: "1px solid #ffd166",
			color: "#ffd166",
			borderRadius: "8px",
			padding: "10px 16px",
			fontSize: "14px",
			fontFamily: "sans-serif",
			transition: "opacity .4s",
			display: "none",
			maxWidth: "420px",
			pointerEvents: "none",
		});
		document.body.appendChild(RWUI.toastEl);
	}
	RWUI.toastEl.textContent = msg;
	RWUI.toastEl.style.display = "block";
	RWUI.toastEl.style.opacity = "1";
	if (RWToastTimer) clearTimeout(RWToastTimer);
	RWToastTimer = setTimeout(() => {
		RWUI.toastEl.style.opacity = "0";
		setTimeout(() => { if (RWUI.toastEl) RWUI.toastEl.style.display = "none"; }, 400);
	}, 3000);
}

 
function RWUIRawEdgeBetween(idA, idB) {
	return RWStore.load().edges.some(e => (e.a === idA && e.b === idB) || (e.a === idB && e.b === idA));
}

 
function RWChatInputClear(input) {
	if (!input) return;
	input.value = "";
	try {
		input.dispatchEvent(new InputEvent("input"));
	} catch (e) {
		
	}
}

 

 
function RWExposeAPI() {
	const g = (typeof globalThis !== "undefined") ? globalThis
		: (typeof window !== "undefined" ? window : null);
	if (!g) return;
	g.RelationWebOpen = RelationWebOpen;
	g.RelationWebClose = RelationWebClose;
	g.RelationWebToggle = RelationWebToggle;
	g.RelationWeb = {
		Open: RelationWebOpen,
		Close: RelationWebClose,
		Toggle: RelationWebToggle,
		IsOpen: () => RWUI.open,
		Export: RWExportJSON,
		Import: (json) => RWImportJSON(json),
		Clear: RWClearAll,
		State: () => RWStore.load(),
	};
}

function RWInstallHooks(mod) {
	const safe = (fn) => (...args) => {
		try { return fn(...args); } catch (e) { RWErr(e); }
	};

	
	try {
		mod.hookFunction("CharacterLoadOnline", 10, (args, next) => {
			const res = next(args);
			safe(RWCollectFromSync)(args[0]);
			return res;
		});
	} catch (e) { RWErr("hook CharacterLoadOnline 失败", e); }

	
	try {
		mod.hookFunction("InformationSheetLoadCharacter", 10, (args, next) => {
			const res = next(args);
			safe(RWCollectFromChar)(args[0]);
			return res;
		});
	} catch (e) { RWErr("hook InformationSheetLoadCharacter 失败", e); }

	
	try {
		mod.hookFunction("ChatRoomMessage", 10, (args, next) => {
			const data = args[0];
			safe(() => {
				if (data && typeof data.Sender === "number") RWMarkSeen([data.Sender], RWNow());
				RWCollectFromDictionary(data && data.Dictionary);
			})();
			return next(args);
		});
	} catch (e) { RWErr("hook ChatRoomMessage 失败", e); }

	
	try {
		mod.hookFunction("ChatRoomSendChat", 10, (args, next) => {
			const input = document.getElementById("InputChat");
			const raw = input ? input.value : "";
			const t = (raw || "").trim().toLowerCase();
			if (t === "/rw" || t === "/relweb" || t === "/关系网") {
				
				RWChatInputClear(input);
				safe(RelationWebToggle)();
				return;
			}
			return next(args);
		});
	} catch (e) { RWErr("hook ChatRoomSendChat 失败", e); }

	
	try {
		RWCollectIntervalId = setInterval(() => {
			safe(() => {
				RWCollectFromPlayer();
				if (typeof ChatRoomCharacter !== "undefined" && Array.isArray(ChatRoomCharacter)) {
					for (const C of ChatRoomCharacter) RWCollectFromChar(C);
				}
			})();
		}, 60000);
	} catch (e) { RWErr("定时采集启动失败", e); }
}

function RWMain() {
	if (typeof window !== "undefined" && window.RelationWebInstalled) {
		RWLog("已安装，跳过重复加载");
		return;
	}
	const tryRegister = (tries) => {
		if (typeof bcModSdk === "undefined" || !bcModSdk.registerMod) {
			if (tries > 600) {
				RWErr("等待 bcModSdk 超时（60 秒），mod 未能加载");
				return;
			}
			setTimeout(() => tryRegister(tries + 1), 100);
			return;
		}
		try {
			const mod = bcModSdk.registerMod({
				name: "RelationWeb",
				fullName: "Relation Web — 关系网收集器",
				version: "1.4.1",
				repository: "",
			}, { allowReplace: true });
			RWStore.load();
			
			RWUI.lang = RWStorage.get("RelationWebLang") === "en" ? "en" : "zh";
			RWExposeAPI();
			RWInstallHooks(mod);
			if (typeof window !== "undefined") window.RelationWebInstalled = true;
			RWLog("已加载。聊天室输入 /rw 开关关系网浮窗；控制台可用 RelationWebOpen() / window.RelationWeb 等接口");
		} catch (e) {
			RWErr("注册 mod 失败", e);
		}
	};
	tryRegister(0);
}

if (typeof window !== "undefined" && typeof window.document !== "undefined") {
	RWMain();
}

 
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		RWStore, RWNow,
		RWRecordAccount, RWRecordRelationship, RWEnsurePerson, RWMarkSeen,
		RWMergePersons, RWUnmergeNum, RWDeletePerson, RWClearAll,
		RWFindPersonById, RWFindPersonByNum, RWMainName, RWMainDisplayName,
		RWExportJSON, RWImportJSON,
		RWCollectFromSync, RWCollectFromChar,
		RWUI, RWUISearchMatch, RWUIVisiblePersons, RWCollectSeen,
		RWUIDescOpen, RWUIDescClose, RWUIDescSelectNum, RWPersonBioLen,
	};
}

})();

