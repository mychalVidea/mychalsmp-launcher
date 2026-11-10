/**
 * Modrinth Catalog Integration for MYCHAL SMP Launcher
 */
const nativeLoader = require('./nativeLoader');

const CURATED_MODS = [
    {
        id: 'sodium',
        title: 'Sodium',
        author: 'jellysquid3',
        downloads: 245000000,
        follows: 34000,
        icon_url: 'https://cdn.modrinth.com/data/AANobbMI/295862f4724dc3f78df3447ad6072b2dcd3ef0c9_96.webp',
        description: 'Revoluční rendering engine pro Minecraft. Zvyšuje FPS až o 300 % a eliminuje propady snímků.',
        categories: ['optimization'],
        loaders: ['fabric', 'neoforge'],
        installed: false
    },
    {
        id: 'iris',
        title: 'Iris Shaders',
        author: 'IMS212',
        downloads: 142000000,
        follows: 21500,
        icon_url: 'https://cdn.modrinth.com/data/YL57xq9U/icon.png',
        description: 'Moderní podpora pro shadery plně kompatibilní se Sodium bez zbytečného propadu FPS.',
        categories: ['optimization', 'utility'],
        loaders: ['fabric', 'neoforge'],
        installed: false
    },
    {
        id: 'lithium',
        title: 'Lithium',
        author: 'CaffeineMC',
        downloads: 165000000,
        follows: 18900,
        icon_url: 'https://cdn.modrinth.com/data/gvQqBUqZ/icon.png',
        description: 'Optimalizace fyziky, chunk tickingu a chování mobů bez změny vanilla mechanik.',
        categories: ['optimization'],
        loaders: ['fabric', 'neoforge'],
        installed: false
    },
    {
        id: 'ferrite-core',
        title: 'FerriteCore',
        author: 'malte0811',
        downloads: 110000000,
        follows: 14200,
        icon_url: 'https://cdn.modrinth.com/data/uXXizFIs/icon.png',
        description: 'Ušetří až 40 % RAM redukcí velikosti vnitřních stavových struktur Minecraftu.',
        categories: ['optimization'],
        loaders: ['fabric', 'forge', 'neoforge'],
        installed: false
    },
    {
        id: 'appleskin',
        title: 'AppleSkin',
        author: 'squeek502',
        downloads: 98000000,
        follows: 16400,
        icon_url: 'https://cdn.modrinth.com/data/EsAfCjCV/icon.png',
        description: 'Zobrazení saturace a nutriční hodnoty jídla přímo v HUDu na panelu hladu.',
        categories: ['utility'],
        loaders: ['fabric', 'forge', 'neoforge'],
        installed: false
    },
    {
        id: 'journeymap',
        title: 'JourneyMap',
        author: 'techbrew',
        downloads: 87000000,
        follows: 15300,
        icon_url: 'https://cdn.modrinth.com/data/O5hpnWre/icon.png',
        description: 'Detailní mapa světa v reálném čase, minimapa na obrazovce a možnost označování waypointů.',
        categories: ['utility', 'adventure'],
        loaders: ['fabric', 'forge', 'neoforge'],
        installed: false
    },
    {
        id: 'entityculling',
        title: 'Entity Culling',
        author: 'tr7zw',
        downloads: 64000000,
        follows: 9800,
        icon_url: 'https://cdn.modrinth.com/data/NNAgCjsB/icon.png',
        description: 'Nevykresluje moby a entity schované za zdmi a v jeskyních, což dramaticky šetří výkon.',
        categories: ['optimization'],
        loaders: ['fabric', 'forge', 'neoforge'],
        installed: false
    },
    {
        id: 'modernfix',
        title: 'ModernFix',
        author: 'embeddedt',
        downloads: 54000000,
        follows: 8200,
        icon_url: 'https://cdn.modrinth.com/data/nmDcB62a/icon.png',
        description: 'Všestranná sada oprav a optimalizací zrychlující start hry a snižující paměťové špičky.',
        categories: ['optimization'],
        loaders: ['fabric', 'forge', 'neoforge'],
        installed: false
    }
];

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CURATED_PACKS = [
    {
        id: 'complementary-reimagined',
        title: 'Complementary Reimagined',
        author: 'EminGT',
        downloads: 28000000,
        follows: 31000,
        icon_url: 'https://cdn.modrinth.com/data/R2DWtGli/icon.png',
        description: 'Vizuálně dechberoucí shadery s perfektním osvětlením, reálnou vodou a vysokou optimalizací pro síť MYCHAL SMP.',
        project_type: 'shader',
        categories: [],
        loaders: [],
        installed: false
    },
    {
        id: 'bsl-shaders',
        title: 'BSL Shaders',
        author: 'Capt_Tatsu',
        downloads: 19000000,
        follows: 18000,
        icon_url: 'https://cdn.modrinth.com/data/Q1fqSIsb/icon.png',
        description: 'Klasické jasné a čisté shadery s teplým nasvícením a skvělým výkonem na moderních grafikách.',
        project_type: 'shader',
        categories: [],
        loaders: [],
        installed: false
    },
    {
        id: 'bare-bones',
        title: 'Bare Bones',
        author: 'RobotPantaloons',
        downloads: 14000000,
        follows: 12500,
        icon_url: 'https://cdn.modrinth.com/data/nfn09w0i/icon.png',
        description: 'Ikonický resource pack napodobující vzhled oficiálních Minecraft trailerů s minimalistickými barvami.',
        project_type: 'resourcepack',
        categories: [],
        loaders: [],
        installed: false
    },
    {
        id: 'fresh-animations',
        title: 'Fresh Animations',
        author: 'FreshLX',
        downloads: 32000000,
        follows: 39000,
        icon_url: 'https://cdn.modrinth.com/data/Q1b5Smf8/icon.png',
        description: 'Dynamické a živé animace pro všechny moby a zvířata v Minecraftu.',
        project_type: 'resourcepack',
        categories: [],
        loaders: [],
        installed: false
    }
];

async function searchModrinth(query = '', version = '26.3', loader = 'fabric', category = '', projectType = 'mod', offset = 0, limit = 24) {
    const type = projectType || 'mod';
    try {
        const facets = [[`project_type:${type}`]];
        if (category) {
            facets.push([`categories:${category}`]);
        }
        if (type === 'mod' && loader) {
            facets.push([`categories:${loader}`]);
        }
        // Pokud je zvolena verze hry, VŽDY filtrujeme podle ní (při procházení i vyhledávání dotazem)
        if (version) {
            facets.push([`versions:${version}`]);
        }

        const params = new URLSearchParams({
            query: query.trim(),
            limit: String(limit || 24),
            offset: String(offset || 0),
            index: 'relevance'
        });

        const url = `https://api.modrinth.com/v2/search?${params.toString()}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'mychalVidea/mychalsmp-launcher/1.0.0 (admin@mychalsmp.xyz)'
            },
            signal: AbortSignal.timeout(4000)
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.hits && data.hits.length > 0) {
            const rawHits = version
                ? data.hits.filter(h => !Array.isArray(h.versions) || h.versions.length === 0 || h.versions.includes(version))
                : data.hits;

            // Získáme verze pro jednotlivé hity pro spolehlivou detekci verzí
            const versionIds = rawHits.map(h => h.latest_version).filter(Boolean);
            const versionMap = new Map();
            if (versionIds.length > 0) {
                try {
                    const vRes = await fetch(`https://api.modrinth.com/v2/versions?ids=${encodeURIComponent(JSON.stringify(versionIds))}`, {
                        headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' },
                        signal: AbortSignal.timeout(3000)
                    });
                    if (vRes.ok) {
                        const vList = await vRes.json();
                        for (const v of vList) {
                            const meta = {
                                version_number: v.version_number,
                                game_versions: v.game_versions || []
                            };
                            if (v.id) versionMap.set(v.id, meta);
                            if (v.project_id) versionMap.set(v.project_id, meta);
                        }
                    }
                } catch (_) {}
            }

            return rawHits.map(h => {
                const vMeta = versionMap.get(h.latest_version) || versionMap.get(h.project_id) || null;
                const projectGameVersions = Array.isArray(h.versions) && h.versions.length > 0
                    ? h.versions
                    : (vMeta ? vMeta.game_versions : []);
                return {
                    id: h.slug || h.project_id,
                    slug: h.slug || h.id,
                    project_id: h.project_id,
                    title: h.title,
                    author: h.author,
                    downloads: h.downloads,
                    follows: h.follows,
                    icon_url: h.icon_url || 'assets/server-icon.png',
                    description: h.description,
                    project_type: h.project_type || type,
                    categories: h.categories || [],
                    loaders: (h.categories || []).filter(c => ['fabric', 'forge', 'neoforge'].includes(c)),
                    latest_version_id: h.latest_version,
                    latest_version_number: vMeta ? vMeta.version_number : null,
                    latest_game_versions: projectGameVersions,
                    is_compatible: projectGameVersions.length === 0 || projectGameVersions.includes(version)
                };
            });
        }
    } catch (err) {
        // Fallback to curated items
    }

    const fallbackList = type === 'mod' ? CURATED_MODS : CURATED_PACKS.filter(p => p.project_type === type);
    return fallbackList.filter(m => {
        if (query && !m.title.toLowerCase().includes(query.toLowerCase()) && !m.description.toLowerCase().includes(query.toLowerCase())) {
            return false;
        }
        if (category && m.categories && !m.categories.includes(category)) {
            return false;
        }
        return true;
    });
}

async function downloadToFileWithProgress(url, destPath, onProgress) {
    if (!onProgress && nativeLoader.isNativeActive()) {
        try {
            await nativeLoader.fastDownloadFile(url, destPath);
            return;
        } catch (_) {}
    }

    const controller = new AbortController();
    let timeoutTimer = null;
    const resetTimeout = (ms = 45000) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
            try { controller.abort(new Error('ETIMEDOUT')); } catch (_) {}
        }, ms);
    };

    resetTimeout(45000);

    try {
        const dlRes = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' }
        });
        if (!dlRes.ok) throw new Error(`Chyba stahování: HTTP ${dlRes.status}`);

        const contentLength = parseInt(dlRes.headers.get('content-length') || '0', 10);
        const chunks = [];
        let received = 0;

        if (dlRes.body && typeof dlRes.body.getReader === 'function') {
            const reader = dlRes.body.getReader();
            while (true) {
                resetTimeout(45000);
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(Buffer.from(value));
                received += value.length;
                if (typeof onProgress === 'function') {
                    const percent = contentLength > 0 ? Math.min(100, Math.round((received / contentLength) * 100)) : 0;
                    onProgress(received, contentLength, percent);
                }
            }
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.writeFileSync(destPath, Buffer.concat(chunks));
        } else {
            resetTimeout(45000);
            const buffer = await dlRes.arrayBuffer();
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.writeFileSync(destPath, Buffer.from(buffer));
            if (typeof onProgress === 'function') {
                onProgress(buffer.byteLength, buffer.byteLength, 100);
            }
        }
    } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer);
    }
}

/**
 * Resolves a mod ID, slug, or dependency reference into a canonical Modrinth project object.
 */
async function resolveModrinthProject(rawId) {
    if (!rawId) return null;
    const clean = String(rawId).trim();
    const candidates = [clean, clean.replace(/_/g, '-')];
    if (clean.toLowerCase() === 'fabric') {
        candidates.unshift('fabric-api');
    }

    for (const c of candidates) {
        try {
            const res = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(c)}`, {
                headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' },
                signal: AbortSignal.timeout(4000)
            });
            if (res.ok) {
                const data = await res.json();
                return {
                    id: data.id,
                    slug: data.slug,
                    title: data.title
                };
            }
        } catch (_) {}
    }

    // Vyhledání podle dotazu jako fallback
    try {
        const query = clean.replace(/[_-]/g, ' ');
        const sUrl = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=3`;
        const sRes = await fetch(sUrl, {
            headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' },
            signal: AbortSignal.timeout(4000)
        });
        if (sRes.ok) {
            const sData = await sRes.json();
            if (sData.hits && sData.hits.length > 0) {
                const hit = sData.hits[0];
                return {
                    id: hit.project_id || hit.slug,
                    slug: hit.slug,
                    title: hit.title
                };
            }
        }
    } catch (_) {}

    return null;
}

/**
 * Checks if a mod/dependency is already present in destDir (e.g. mods folder)
 * Returns { installed: boolean, disabled: boolean, filename: string, fullPath: string }
 */
function isModInstalledInDir(destDir, modIdentifier) {
    if (!destDir || !fs.existsSync(destDir) || !modIdentifier) return null;

    const rawId = String(modIdentifier).trim().toLowerCase();
    const hyphenId = rawId.replace(/_/g, '-');
    const underscoreId = rawId.replace(/-/g, '_');

    // 1. Zkontrolujeme .mod_meta.json
    try {
        const metaPath = path.join(destDir, '.mod_meta.json');
        if (fs.existsSync(metaPath)) {
            const metaObj = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            for (const [fname, meta] of Object.entries(metaObj)) {
                const mId = (meta.id || '').toLowerCase();
                const mSlug = (meta.slug || '').toLowerCase();
                const mTitle = (meta.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

                if (
                    mId === rawId || mId === hyphenId || mId === underscoreId ||
                    mSlug === rawId || mSlug === hyphenId || mSlug === underscoreId ||
                    mTitle === rawId.replace(/[^a-z0-9]/g, '')
                ) {
                    const fullPath = path.join(destDir, fname);
                    const disabledPath = fullPath + '.disabled';
                    if (fs.existsSync(fullPath)) {
                        return { installed: true, disabled: false, filename: fname, fullPath };
                    } else if (fs.existsSync(disabledPath)) {
                        return { installed: true, disabled: true, filename: fname + '.disabled', fullPath: disabledPath };
                    }
                }
            }
        }
    } catch (_) {}

    // 2. Prohledáme reálné soubory ve složce
    try {
        const files = fs.readdirSync(destDir);
        for (const f of files) {
            const lowerF = f.toLowerCase();
            const cleanF = lowerF.replace(/\.disabled$/i, '').replace(/\.jar$/i, '');
            const isDisabled = lowerF.endsWith('.disabled');

            // Vyhneme se falešným shodám typu sodium-extra pro dotaz na sodium
            if ((rawId === 'sodium' || rawId === 'aanobbmi') && (cleanF.includes('extra') || cleanF.includes('options') || cleanF.includes('menu'))) {
                continue;
            }

            const isExact = cleanF === rawId || cleanF === hyphenId || cleanF === underscoreId;
            const startsWithPrefix = (
                cleanF.startsWith(rawId + '-') || cleanF.startsWith(hyphenId + '-') || cleanF.startsWith(underscoreId + '-') ||
                cleanF.startsWith(rawId + '_') || cleanF.startsWith(hyphenId + '_') || cleanF.startsWith(underscoreId + '_')
            );
            const loaderPrefixMatch = (
                cleanF.startsWith('fabric-' + rawId) || cleanF.startsWith('fabric_' + rawId) ||
                cleanF.startsWith('fabric-' + hyphenId) || cleanF.startsWith('fabric_' + underscoreId)
            );

            if (isExact || startsWithPrefix || loaderPrefixMatch) {
                return {
                    installed: true,
                    disabled: isDisabled,
                    filename: f,
                    fullPath: path.join(destDir, f)
                };
            }
        }
    } catch (_) {}

    return null;
}

/**
 * Downloads a mod, resourcepack, or shader from Modrinth directly into the profile's directory.
 */
async function downloadModOrPack(options, targetDir) {
    const { id, title, projectType = 'mod', version = '26.3', loader = 'fabric', oldFilename, directUrl } = options;
    const normLoader = (loader && loader !== 'vanilla') ? loader.toLowerCase() : null;

    // 0. Pokud máme přímou URL ke stažení ze Seedu, zkusíme nejprve bleskové přímé stažení
    if (directUrl) {
        try {
            const subfolder = projectType === 'shader' ? 'shaderpacks' :
                              projectType === 'resourcepack' ? 'resourcepacks' : 'mods';
            const destDir = path.join(targetDir, subfolder);
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

            let outFilename = options.filename;
            if (!outFilename) {
                try {
                    outFilename = path.basename(new URL(directUrl).pathname);
                } catch (_) {
                    outFilename = `${id}.jar`;
                }
            }
            if (oldFilename) {
                const oldPath = path.join(destDir, oldFilename);
                try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch (_) {}
                const oldDisabled = oldPath + '.disabled';
                try { if (fs.existsSync(oldDisabled)) fs.unlinkSync(oldDisabled); } catch (_) {}
            }

            const destPath = path.join(destDir, outFilename);
            await downloadToFileWithProgress(directUrl, destPath, options.onProgress);

            const metaPath = path.join(destDir, '.mod_meta.json');
            let metaObj = {};
            if (fs.existsSync(metaPath)) {
                try { metaObj = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) {}
            }
            if (oldFilename && oldFilename !== outFilename) {
                delete metaObj[oldFilename];
                delete metaObj[oldFilename + '.disabled'];
                delete metaObj[oldFilename.replace(/\.disabled$/i, '')];
            }
            metaObj[outFilename] = {
                id: id || outFilename,
                slug: options.slug || id,
                title: title || id,
                version: options.version || null,
                loader: normLoader,
                projectType: projectType,
                downloadUrl: directUrl,
                downloadedAt: Date.now()
            };
            fs.writeFileSync(metaPath, JSON.stringify(metaObj, null, 2), 'utf8');
            return {
                success: true,
                filename: outFilename,
                subfolder,
                destPath,
                resolvedLoader: normLoader
            };
        } catch (e) {
            console.warn(`[DIRECT-DL] Přímé stažení selhalo, zkouším Modrinth API:`, e.message);
        }
    }

    let versions = [];

    if (projectType === 'mod' && normLoader) {
        // 1. Zkusíme načíst verze specificky pro požadovaný loader i verzi hry
        try {
            const verUrl = `https://api.modrinth.com/v2/project/${encodeURIComponent(id)}/version?loaders=${encodeURIComponent(JSON.stringify([normLoader]))}&game_versions=${encodeURIComponent(JSON.stringify([version]))}`;
            const vRes = await fetch(verUrl, {
                headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' }
            });
            if (vRes.ok) {
                const list = await vRes.json();
                if (Array.isArray(list) && list.length > 0) {
                    versions = list;
                }
            }
        } catch (_) {}

        // 2. Pokud není verze pro přesný tag hry, načteme verze pro daný loader
        if (versions.length === 0) {
            try {
                const ldrUrl = `https://api.modrinth.com/v2/project/${encodeURIComponent(id)}/version?loaders=${encodeURIComponent(JSON.stringify([normLoader]))}`;
                const lRes = await fetch(ldrUrl, {
                    headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' }
                });
                if (lRes.ok) {
                    const list = await lRes.json();
                    if (Array.isArray(list) && list.length > 0) {
                        versions = list;
                    }
                }
            } catch (_) {}
        }

        // Pokud pro požadovaný loader neexistuje ŽÁDNÁ verze, striktně odmítneme stažení!
        // Nikdy nestahujeme Forge na Fabric profil a naopak!
        if (versions.length === 0) {
            throw new Error(`Mód "${title || id}" není dostupný pro zavaděč ${normLoader.toUpperCase()}.`);
        }
    } else {
        // Resourcepacky, shadery nebo vanilla profily
        const directUrl = `https://api.modrinth.com/v2/project/${encodeURIComponent(id)}/version`;
        const res = await fetch(directUrl, {
            headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' }
        });
        if (!res.ok) throw new Error(`Projekt ${id} nebyl nalezen na Modrinthu.`);
        versions = await res.json();
    }

    if (!versions || versions.length === 0) throw new Error(`Pro ${title || id} není k dispozici žádný soubor.`);

    // Prefer match for game version if available in list
    let picked = versions.find(v => Array.isArray(v.game_versions) && v.game_versions.includes(version));
    if (!picked && projectType === 'mod') {
        const vPrefix = String(version).split('.').slice(0, 2).join('.');
        picked = versions.find(v => Array.isArray(v.game_versions) && v.game_versions.some(gv => gv === version || gv.startsWith(vPrefix)));
    }
    if (!picked) {
        if (projectType === 'mod') {
            const avail = (versions[0]?.game_versions || []).join(', ') || 'jinou verzi';
            throw new Error(`Mód "${title || id}" není kompatibilní s verzí Minecraftu ${version} (dostupný je pouze pro: ${avail}).`);
        }
        picked = versions[0];
    }

    const file = (picked.files && picked.files.find(f => f.primary)) || (picked.files && picked.files[0]);
    if (!file) throw new Error(`Soubor ke stažení nebyl nalezen.`);

    const subfolder = projectType === 'shader' ? 'shaderpacks' :
                      projectType === 'resourcepack' ? 'resourcepacks' : 'mods';

    const destDir = path.join(targetDir, subfolder);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    // Pokud aktualizujeme existující mód, smažeme původní starší jar, aby nedošlo ke konfliktu duplicitních módů
    if (oldFilename) {
        const oldPath = path.join(destDir, oldFilename);
        try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch (_) {}
        const oldDisabled = oldPath + '.disabled';
        try { if (fs.existsSync(oldDisabled)) fs.unlinkSync(oldDisabled); } catch (_) {}
    }

    const destPath = path.join(destDir, file.filename);
    await downloadToFileWithProgress(file.url, destPath, options.onProgress);

    // Zjistíme, pro jaký loader stažený soubor ve skutečnosti je
    let resolvedLoader = normLoader || 'fabric';
    if (projectType === 'mod' && picked && Array.isArray(picked.loaders) && picked.loaders.length > 0) {
        const pLoaders = picked.loaders.map(l => l.toLowerCase());
        if (normLoader && pLoaders.includes(normLoader)) {
            resolvedLoader = normLoader;
        } else if (pLoaders.includes('fabric')) {
            resolvedLoader = 'fabric';
        } else if (pLoaders.includes('forge')) {
            resolvedLoader = 'forge';
        } else if (pLoaders.includes('neoforge')) {
            resolvedLoader = 'neoforge';
        } else {
            resolvedLoader = pLoaders[0];
        }
    }

    // Uložíme metadata do .mod_meta.json pro 100% spolehlivou detekci nainstalovaného módu
    try {
        const metaPath = path.join(destDir, '.mod_meta.json');
        let metaObj = {};
        if (fs.existsSync(metaPath)) {
            try { metaObj = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) {}
        }
        if (oldFilename && oldFilename !== file.filename) {
            delete metaObj[oldFilename];
            delete metaObj[oldFilename + '.disabled'];
            delete metaObj[oldFilename.replace(/\.disabled$/i, '')];
        }
        metaObj[file.filename] = {
            id: id,
            slug: options.slug || id,
            title: title || id,
            version: picked.version_number,
            loader: resolvedLoader,
            projectType: projectType,
            downloadUrl: file.url,
            downloadedAt: Date.now()
        };
        fs.writeFileSync(metaPath, JSON.stringify(metaObj, null, 2), 'utf8');
    } catch (_) {}

    // Automatické stažení vyžadovaných závislostí (dependencies)
    const dependenciesInstalled = [];
    if (projectType === 'mod' && Array.isArray(picked.dependencies) && picked.dependencies.length > 0) {
        const visited = options._visited || new Set();
        visited.add(String(id).toLowerCase());
        if (options.slug) visited.add(String(options.slug).toLowerCase());
        if (picked.project_id) visited.add(String(picked.project_id).toLowerCase());

        const requiredDeps = picked.dependencies.filter(d => d && d.dependency_type === 'required');
        for (const dep of requiredDeps) {
            const depProjId = dep.project_id || dep.version_id;
            if (!depProjId) continue;
            const normDepId = String(depProjId).toLowerCase();

            // Ignorujeme interní pseudo-závislosti na Minecraftu a launcherech
            if (['minecraft', 'fabricloader', 'fabric-loader', 'forge', 'neoforge', 'java'].includes(normDepId)) {
                continue;
            }

            if (visited.has(normDepId)) {
                continue;
            }

            // Ověříme, zda závislost již není přítomna v mods složce
            const check = isModInstalledInDir(destDir, depProjId);
            let isOutdatedDep = false;
            let oldDepFilename = null;

            if (check && check.installed) {
                const normCheckName = (check.filename || '').toLowerCase();
                if ((normDepId === 'sodium' || normDepId === 'aanobbmi') && (version === '26.2' || String(version).startsWith('26.'))) {
                    if (!normCheckName.includes('0.9')) {
                        isOutdatedDep = true;
                        oldDepFilename = check.filename;
                    }
                }

                if (!isOutdatedDep) {
                    // Pokud byla závislost pouze deaktivována (.disabled), znovu ji povolíme
                    if (check.disabled && check.fullPath) {
                        try {
                            const targetEnabled = check.fullPath.replace(/\.disabled$/i, '');
                            fs.renameSync(check.fullPath, targetEnabled);
                            console.log(`[DEPENDENCY] Re-aktivována deaktivovaná závislost: ${check.filename}`);
                            dependenciesInstalled.push({
                                id: depProjId,
                                title: depProjId,
                                filename: path.basename(targetEnabled),
                                reEnabled: true
                            });
                        } catch (_) {}
                    }
                    visited.add(normDepId);
                    continue;
                }
            }

            // Vyhledáme závislost na Modrinthu a automaticky ji stáhneme
            try {
                const resolved = await resolveModrinthProject(depProjId);
                if (resolved && !visited.has(resolved.id.toLowerCase()) && !visited.has(resolved.slug.toLowerCase())) {
                    visited.add(resolved.id.toLowerCase());
                    visited.add(resolved.slug.toLowerCase());

                    console.log(`[DEPENDENCY] Automaticky stahuji chybějící vyžadovanou závislost: ${resolved.title || resolved.slug} (${depProjId})`);
                    const depResult = await downloadModOrPack({
                        id: resolved.id || resolved.slug,
                        slug: resolved.slug,
                        title: resolved.title,
                        projectType: 'mod',
                        version: version,
                        loader: resolvedLoader || normLoader,
                        oldFilename: oldDepFilename,
                        _visited: visited
                    }, targetDir);

                    if (depResult && depResult.success) {
                        dependenciesInstalled.push({
                            id: resolved.id,
                            slug: resolved.slug,
                            title: resolved.title,
                            filename: depResult.filename
                        });
                        if (Array.isArray(depResult.dependenciesInstalled)) {
                            dependenciesInstalled.push(...depResult.dependenciesInstalled);
                        }
                    }
                }
            } catch (depErr) {
                console.warn(`[DEPENDENCY] Nepodařilo se stáhnout závislost ${depProjId}:`, depErr.message);
            }
        }
    }

    return {
        success: true,
        filename: file.filename,
        version_number: picked.version_number,
        subfolder,
        destPath,
        resolvedLoader: projectType === 'mod' ? resolvedLoader : null,
        dependenciesInstalled
    };
}

const modUpdatesCache = new Map();

/**
 * Kontroluje aktualizace nainstalovaných módů v profilu přes Modrinth API.
 * Využívá hromadný endpoint /v2/version_files/update pro bleskový dotaz během stovek milisekund.
 * Obsahuje inteligentní diskovou a časovou cache (30 min), aby neblokoval spuštění hry síťovými dotazy.
 */
async function checkProfileModUpdates({ profileId, gameDir, version = '26.3', loader = 'fabric', force = false }) {
    const modsDir = path.join(gameDir, 'mods');
    if (!fs.existsSync(modsDir)) {
        return { success: true, updates: [] };
    }

    const normLoader = (loader && loader !== 'vanilla') ? loader.toLowerCase() : 'fabric';
    const normVersion = version || '26.3';

    let files = [];
    try {
        files = fs.readdirSync(modsDir).filter(f => f.toLowerCase().endsWith('.jar'));
    } catch (_) {
        return { success: true, updates: [] };
    }

    if (files.length === 0) {
        return { success: true, updates: [] };
    }

    // ⚡ Inteligentní cache otisku složky: pokud se nezměnily soubory ani jejich mtime a neuplynuly 2 hodiny, vrátíme výsledek ihned (0 ms)
    const cacheKey = `${profileId || gameDir}:${normLoader}:${normVersion}`;
    let dirFingerprint = '';
    try {
        dirFingerprint = files.map(f => {
            const st = fs.statSync(path.join(modsDir, f));
            return `${f}:${st.size}:${Math.floor(st.mtimeMs)}`;
        }).join('|');
    } catch (_) { }

    if (!force && modUpdatesCache.has(cacheKey)) {
        const cached = modUpdatesCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < 2 * 60 * 60 * 1000) && cached.fingerprint === dirFingerprint) {
            return { success: true, updates: cached.updates, fromCache: true };
        }
    }

    let metaMap = {};
    const metaPath = path.join(modsDir, '.mod_meta.json');
    if (fs.existsSync(metaPath)) {
        try { metaMap = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) {}
    }

    const fileByHash = {};
    const hashes = [];

    for (const f of files) {
        try {
            const fullPath = path.join(modsDir, f);
            const buf = fs.readFileSync(fullPath);
            const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
            hashes.push(sha1);
            fileByHash[sha1] = {
                filename: f,
                fullPath,
                fileMeta: metaMap[f] || metaMap[f.replace(/\.disabled$/i, '')] || null,
                cleanName: f.replace(/\.jar$/i, '')
            };
        } catch (_) {}
    }

    if (hashes.length === 0) {
        return { success: true, updates: [] };
    }

    const updates = [];

    try {
        const res = await fetch('https://api.modrinth.com/v2/version_files/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'mychalVidea/mychalsmp-launcher (support@mychalsmp.xyz)'
            },
            body: JSON.stringify({
                hashes: hashes,
                algorithm: 'sha1',
                loaders: [normLoader],
                game_versions: [normVersion]
            }),
            signal: AbortSignal.timeout(4000)
        });

        if (res.ok) {
            const updateMap = await res.json();
            for (const [oldHash, vObj] of Object.entries(updateMap)) {
                const localItem = fileByHash[oldHash];
                if (!localItem || !vObj) continue;

                const primaryFile = (vObj.files || []).find(f => f.primary) || (vObj.files || [])[0];
                if (!primaryFile) continue;

                // Ověříme, zda je hash jiný (skutečně novější soubor)
                const newHash = primaryFile.hashes?.sha1;
                if (newHash && newHash === oldHash) continue;
                if (primaryFile.filename === localItem.filename && newHash === oldHash) continue;

                const title = localItem.fileMeta?.title || vObj.name || localItem.cleanName;
                updates.push({
                    id: vObj.project_id,
                    title: title,
                    currentVersion: localItem.fileMeta?.version || null,
                    newVersion: vObj.version_number,
                    oldFilename: localItem.filename,
                    newFilename: primaryFile.filename,
                    directUrl: primaryFile.url,
                    size: primaryFile.size,
                    projectType: 'mod'
                });
            }
        }
    } catch (apiErr) {
        console.warn('[MOD UPDATES] Chyba při volání Modrinth /v2/version_files/update:', apiErr.message);
    }

    modUpdatesCache.set(cacheKey, {
        timestamp: Date.now(),
        fingerprint: dirFingerprint,
        updates: updates
    });

    return { success: true, updates };
}

module.exports = {
    searchModrinth,
    downloadModOrPack,
    resolveModrinthProject,
    isModInstalledInDir,
    checkProfileModUpdates,
    CURATED_MODS,
    CURATED_PACKS
};
