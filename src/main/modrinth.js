/**
 * Modrinth Catalog Integration for MYCHAL SMP Launcher
 */

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

async function searchModrinth(query = '', version = '26.2', loader = 'fabric', category = '', projectType = 'mod', offset = 0, limit = 24) {
    const type = projectType || 'mod';
    try {
        const facets = [[`project_type:${type}`]];
        if (category) {
            facets.push([`categories:${category}`]);
        }
        if (type === 'mod' && loader) {
            facets.push([`categories:${loader}`]);
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
            // Získáme verze pro jednotlivé hity pro spolehlivou detekci verzí
            const versionIds = data.hits.map(h => h.latest_version).filter(Boolean);
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

            return data.hits.map(h => {
                const vMeta = versionMap.get(h.latest_version) || versionMap.get(h.project_id) || null;
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
                    latest_game_versions: vMeta ? vMeta.game_versions : (h.game_versions || [])
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

/**
 * Downloads a mod, resourcepack, or shader from Modrinth directly into the profile's directory.
 */
async function downloadModOrPack(options, targetDir) {
    const { id, title, projectType = 'mod', version = '26.2', loader = 'fabric', oldFilename, directUrl } = options;
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
            const destPath = path.join(destDir, outFilename);
            const dlRes = await fetch(directUrl, {
                headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' }
            });
            if (dlRes.ok) {
                const buffer = await dlRes.arrayBuffer();
                fs.writeFileSync(destPath, Buffer.from(buffer));
                const metaPath = path.join(destDir, '.mod_meta.json');
                let metaObj = {};
                if (fs.existsSync(metaPath)) {
                    try { metaObj = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) {}
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
            }
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
    if (!picked) {
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
    const dlRes = await fetch(file.url, {
        headers: { 'User-Agent': 'mychalVidea/mychalsmp-launcher' }
    });
    if (!dlRes.ok) throw new Error(`Chyba stahování: HTTP ${dlRes.status}`);

    const buffer = await dlRes.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(buffer));

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

    return {
        success: true,
        filename: file.filename,
        version_number: picked.version_number,
        subfolder,
        destPath,
        resolvedLoader: projectType === 'mod' ? resolvedLoader : null
    };
}

module.exports = {
    searchModrinth,
    downloadModOrPack,
    CURATED_MODS,
    CURATED_PACKS
};
