const page = document.body.dataset.page || 'inventory';

const state = {
    view: 'meals',
    veggie: false,
    expiring: false,
    q: '',
};

const containerState = {
    active: '1',
    types: [],
};

const recipeState = {
    search: '',
    type: '',
    veggie: false,
    vegan: false,
    sort: 'name',
    list: [],
    editingId: null,
};

document.addEventListener('DOMContentLoaded', () => {
    bindMenu();
    if (page === 'inventory') {
        bindFilters();
        bindModal();
        loadData();
    } else if (page === 'recipes') {
        bindRecipePage();
    } else {
        bindContainerForms();
        loadContainerTypes();
        loadContainers();
    }
});

function bindFilters() {
    document.querySelectorAll('.pill').forEach((btn) => {
        btn.addEventListener('click', () => {
            const filter = btn.dataset.filter;
            if (filter === 'view') {
                state.view = btn.dataset.value;
                document.querySelectorAll('button[data-filter="view"]').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
            } else if (filter === 'veggie') {
                state.veggie = !state.veggie;
                btn.classList.toggle('active', state.veggie);
            } else if (filter === 'expiring') {
                state.expiring = !state.expiring;
                btn.classList.toggle('active', state.expiring);
            }
            loadData();
        });
    });

    const search = document.getElementById('search');
    search.addEventListener('input', () => {
        state.q = search.value;
        debounceLoad();
    });

    const defaultView = document.querySelector('button[data-filter="view"][data-value="meals"]');
    if (defaultView) {
        defaultView.classList.add('active');
    }
}

let debounceTimer;
function debounceLoad() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadData, 200);
}

function bindMenu() {
    const burger = document.getElementById('burger');
    const drawer = document.getElementById('menu-drawer');
    burger.addEventListener('click', () => {
        drawer.classList.toggle('hidden');
    });
}

function bindModal() {
    const modal = document.getElementById('modal');
    const close = document.getElementById('modal-close');
    close.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });
}

async function loadData() {
    const grid = document.getElementById('grid');
    grid.innerHTML = '<div class="loading">Lade...</div>';

    try {
        if (state.view === 'meals') {
            const meals = await fetchMealSets();
            renderMealCards(meals);
        } else {
            const items = await fetchInventory();
            renderItemCards(items);
        }
    } catch (err) {
        grid.innerHTML = '<div class="error">Fehler beim Laden.</div>';
        console.error(err);
    }
}

function buildQuery() {
    const params = new URLSearchParams();
    if (state.q) params.append('q', state.q);
    if (state.veggie) params.append('veggie', '1');
    if (state.expiring) params.append('expiring', '1');
    return params;
}

async function fetchMealSets() {
    const params = buildQuery();
    const res = await fetch('/api/meal_sets?' + params.toString());
    if (!res.ok) throw new Error('load_failed');
    const json = await res.json();
    return json.items || [];
}

async function fetchInventory() {
    const params = buildQuery();
    params.append('view', state.view);
    const res = await fetch('/api/inventory?' + params.toString());
    if (!res.ok) throw new Error('load_failed');
    const json = await res.json();
    return json.items || [];
}

function renderMealCards(items) {
    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    if (!items.length) {
        grid.innerHTML = '<div class="empty">Keine Sets gefunden.</div>';
        return;
    }

    items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="card-title">${item.name}</div>
            <div class="meta">${item.complete_count}x komplett</div>
            <div class="flags">${renderFlags(item)}</div>
            <div class="fifo">${(item.fifo_ids || []).join(' + ')}</div>
        `;
        card.addEventListener('click', () => openMealModal(item.id));
        grid.appendChild(card);
    });
}

function renderFlags(item) {
    const flags = [];
    if (item.is_vegan) flags.push('🌱 vegan');
    else if (item.is_veggie) flags.push('🥕 veggie');
    if (item.is_expiring) flags.push('⏳ bald ablaufend');
    return flags.join(' · ');
}

function renderItemCards(items) {
    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    if (!items.length) {
        grid.innerHTML = '<div class="empty">Keine Items gefunden.</div>';
        return;
    }

    items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'card';
        const bestBefore = item.computed_best_before ? item.computed_best_before.substring(0, 10) : '-';
        card.innerHTML = `
            <div class="card-title">${item.name} (${item.item_type})</div>
            <div class="meta">ID ${item.id_code}</div>
            <div class="flags">${item.is_veggie ? '🥕' : ''} ${item.is_vegan ? '🌱' : ''}</div>
            <div class="fifo">Frosten: ${item.frozen_at} · MHD: ${bestBefore}</div>
        `;
        card.addEventListener('click', () => openItemModal(item));
        grid.appendChild(card);
    });
}

async function openMealModal(id) {
    const modal = document.getElementById('modal');
    const body = document.getElementById('modal-body');
    body.innerHTML = '<div class="loading">Lade...</div>';
    modal.classList.remove('hidden');

    try {
        const res = await fetch(`/api/meal_sets/${id}`);
        if (!res.ok) throw new Error('load_failed');
        const data = await res.json();
        const itemsList = (data.items || []).map((it) => `
            <li>
                <strong>${it.id_code}</strong> – ${it.name} (${it.item_type})
                <div class="sub">Gefroren: ${it.frozen_at}, MHD: ${it.computed_best_before?.substring(0, 10) || '-'}${it.container_code ? `, Box ${it.container_code}` : ''}</div>
            </li>`).join('');

        body.innerHTML = `
            <h2>${data.name}</h2>
            <div class="flags">${renderFlags(data)}</div>
            <p>${data.complete_count}x komplett verfügbar</p>
            <button class="danger" data-action="takeout" data-id="${data.id}">Entnehmen</button>
            <h3>FIFO Auswahl</h3>
            <ul class="item-list">${itemsList}</ul>
        `;

        const btn = body.querySelector('button[data-action="takeout"]');
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = 'Entnehme...';
            try {
                const res = await fetch(`/api/meal_sets/${id}/takeout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                const json = await res.json();
                if (!res.ok || json.error) throw new Error(json.error || 'takeout_failed');
                modal.classList.add('hidden');
                loadData();
            } catch (err) {
                btn.disabled = false;
                btn.textContent = 'Entnehmen';
                alert('Entnahme fehlgeschlagen');
            }
        });
    } catch (err) {
        body.innerHTML = '<div class="error">Fehler beim Laden.</div>';
    }
}

function openItemModal(item) {
    const modal = document.getElementById('modal');
    const body = document.getElementById('modal-body');
    const bestBefore = item.computed_best_before ? item.computed_best_before.substring(0, 10) : '-';
    body.innerHTML = `
        <h2>${item.name}</h2>
        <div class="meta">${item.id_code} · Typ ${item.item_type}</div>
        <p>Gefroren: ${item.frozen_at}<br/>MHD: ${bestBefore}</p>
        <button class="danger" data-action="takeout-item" data-id="${item.id}">Entnehmen</button>
    `;
    modal.classList.remove('hidden');

    const btn = body.querySelector('button[data-action="takeout-item"]');
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Entnehme...';
        try {
            const res = await fetch('/api/inventory/takeout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_ids: [item.id] }) });
            const json = await res.json();
            if (!res.ok || json.error) throw new Error(json.error || 'takeout_failed');
            modal.classList.add('hidden');
            loadData();
        } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Entnehmen';
            alert('Entnahme fehlgeschlagen');
        }
    });
}

// ----------------------
// Recipes
// ----------------------

function bindRecipePage() {
    const search = document.getElementById('recipe-search');
    const type = document.getElementById('recipe-type-filter');
    const veggie = document.getElementById('recipe-veggie-filter');
    const vegan = document.getElementById('recipe-vegan-filter');
    const sort = document.getElementById('recipe-sort');
    const newBtn = document.getElementById('new-recipe-btn');
    const modal = document.getElementById('recipe-modal');
    const modalClose = document.getElementById('recipe-modal-close');
    const form = document.getElementById('recipe-form');
    const kcalButton = document.getElementById('kcal-estimate');

    if (search) {
        search.addEventListener('input', () => {
            recipeState.search = search.value;
            debounceRecipeLoad();
        });
    }

    if (type) {
        type.addEventListener('change', () => {
            recipeState.type = type.value;
            loadRecipes();
        });
    }

    if (veggie) {
        veggie.addEventListener('change', () => {
            recipeState.veggie = veggie.checked;
            loadRecipes();
        });
    }

    if (vegan) {
        vegan.addEventListener('change', () => {
            recipeState.vegan = vegan.checked;
            loadRecipes();
        });
    }

    if (sort) {
        sort.addEventListener('change', () => {
            recipeState.sort = sort.value;
            loadRecipes();
        });
    }

    if (newBtn) {
        newBtn.addEventListener('click', () => openRecipeModal());
    }

    if (modal && modalClose) {
        modalClose.addEventListener('click', closeRecipeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeRecipeModal();
        });
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveRecipe();
        });
    }

    if (kcalButton) {
        kcalButton.addEventListener('click', () => {
            alert('kommt später');
        });
    }

    loadRecipes();
}

let recipeDebounce;
function debounceRecipeLoad() {
    clearTimeout(recipeDebounce);
    recipeDebounce = setTimeout(loadRecipes, 200);
}

async function loadRecipes() {
    const tbody = document.getElementById('recipes-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" class="loading">Lade...</td></tr>';
    setRecipeError('');

    try {
        const params = new URLSearchParams();
        params.append('limit', '50');
        params.append('offset', '0');
        params.append('sort', recipeState.sort);
        if (recipeState.search) params.append('search', recipeState.search);
        if (recipeState.type) params.append('type', recipeState.type);
        if (recipeState.veggie) params.append('veggie', '1');
        if (recipeState.vegan) params.append('vegan', '1');

        const res = await fetch('/api/recipes?' + params.toString());
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error?.code || 'load_failed');
        recipeState.list = json.data || [];
        renderRecipes(recipeState.list);
    } catch (err) {
        console.error(err);
        setRecipeError('Rezepte konnten nicht geladen werden.');
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Fehler beim Laden.</td></tr>';
    }
}

function renderRecipes(items) {
    const tbody = document.getElementById('recipes-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!items.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Keine Rezepte vorhanden.</td></tr>';
        return;
    }

    items.forEach((item) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(item.name)}</td>
            <td><span class="badge">${item.recipe_type}</span></td>
            <td>${renderRecipeFlags(item)}</td>
            <td>${item.yield_portions ?? '-'}</td>
            <td>${item.kcal_per_portion ?? '-'}</td>
            <td>${formatDate(item.updated_at || item.created_at)}</td>
        `;
        tr.addEventListener('click', () => openRecipeModal(item));
        tbody.appendChild(tr);
    });
}

function renderRecipeFlags(item) {
    const flags = [];
    if (item.is_vegan) flags.push('🌱 vegan');
    else if (item.is_veggie) flags.push('🥕 veggie');
    return flags.join(' ');
}

function openRecipeModal(item = null) {
    recipeState.editingId = item?.id || null;
    const modal = document.getElementById('recipe-modal');
    const title = document.getElementById('recipe-modal-title');
    const form = document.getElementById('recipe-form');
    setRecipeError('', true);

    if (!modal || !form || !title) return;

    form.reset();
    if (item) {
        title.textContent = 'Rezept bearbeiten';
        fillRecipeForm(form, item);
    } else {
        title.textContent = 'Neues Rezept';
    }

    modal.classList.remove('hidden');
}

function fillRecipeForm(form, item) {
    form.elements['name'].value = item.name || '';
    form.elements['recipe_type'].value = item.recipe_type || 'MEAL';
    form.elements['yield_portions'].value = item.yield_portions ?? '';
    form.elements['kcal_per_portion'].value = item.kcal_per_portion ?? '';
    form.elements['default_best_before_days'].value = item.default_best_before_days ?? '';
    form.elements['tags_text'].value = item.tags_text || '';
    form.elements['ingredients_text'].value = item.ingredients_text || '';
    form.elements['prep_text'].value = item.prep_text || '';
    form.elements['reheat_text'].value = item.reheat_text || '';
    form.elements['is_veggie'].checked = !!item.is_veggie;
    form.elements['is_vegan'].checked = !!item.is_vegan;
}

function closeRecipeModal() {
    const modal = document.getElementById('recipe-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    recipeState.editingId = null;
}

async function saveRecipe() {
    const form = document.getElementById('recipe-form');
    if (!form) return;

    const payload = buildRecipePayload(new FormData(form));
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    setRecipeError('', true);

    const method = recipeState.editingId ? 'PATCH' : 'POST';
    const url = recipeState.editingId ? `/api/recipes/${recipeState.editingId}` : '/api/recipes';

    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error?.message || 'save_failed');

        closeRecipeModal();
        showToast('Gespeichert');
        await loadRecipes();
    } catch (err) {
        console.error(err);
        setRecipeError('Speichern fehlgeschlagen.', true);
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function buildRecipePayload(formData) {
    return {
        name: (formData.get('name') || '').toString().trim(),
        recipe_type: formData.get('recipe_type') || 'MEAL',
        yield_portions: toInt(formData.get('yield_portions')),
        kcal_per_portion: toInt(formData.get('kcal_per_portion')),
        default_best_before_days: toInt(formData.get('default_best_before_days')),
        tags_text: (formData.get('tags_text') || '').toString().trim() || null,
        ingredients_text: (formData.get('ingredients_text') || '').toString().trim() || null,
        prep_text: (formData.get('prep_text') || '').toString().trim() || null,
        reheat_text: (formData.get('reheat_text') || '').toString().trim() || null,
        is_veggie: formData.get('is_veggie') ? 1 : 0,
        is_vegan: formData.get('is_vegan') ? 1 : 0,
    };
}

function setRecipeError(message, inModal = false) {
    const targetId = inModal ? 'recipe-modal-error' : 'recipe-error';
    const el = document.getElementById(targetId);
    if (!el) return;
    if (!message) {
        el.classList.add('hidden');
        el.textContent = '';
    } else {
        el.classList.remove('hidden');
        el.textContent = message;
    }
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hidden');
    }, 2000);
}

function formatDate(dateString) {
    if (!dateString) return '-';
    return dateString.substring(0, 10);
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ----------------------
// Container management
// ----------------------

function bindContainerForms() {
    const filter = document.getElementById('container-filter-active');
    if (filter) {
        filter.value = containerState.active;
        filter.addEventListener('change', () => {
            containerState.active = filter.value;
            loadContainers();
        });
    }

    const typeForm = document.getElementById('container-type-form');
    if (typeForm) {
        typeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(typeForm);
            const payload = buildContainerTypePayload(formData);
            try {
                await postJson('/api/container-types', payload);
                typeForm.reset();
                await loadContainerTypes();
                await loadContainers();
            } catch (err) {
                alert('Typ konnte nicht gespeichert werden.');
                console.error(err);
            }
        });
    }

    const containerForm = document.getElementById('container-form');
    if (containerForm) {
        containerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(containerForm);
            const payload = buildContainerPayload(formData);
            try {
                await postJson('/api/containers', payload);
                containerForm.reset();
                await loadContainers();
            } catch (err) {
                alert('Container konnte nicht angelegt werden.');
                console.error(err);
            }
        });
    }
}

function buildContainerTypePayload(formData) {
    const payload = {
        shape: formData.get('shape'),
        volume_ml: toInt(formData.get('volume_ml')),
        height_mm: toInt(formData.get('height_mm')),
        width_mm: toInt(formData.get('width_mm')),
        length_mm: toInt(formData.get('length_mm')),
        material: formData.get('material') || null,
        note: formData.get('note') || null,
    };
    if (!payload.height_mm) delete payload.height_mm;
    if (!payload.width_mm) delete payload.width_mm;
    if (!payload.length_mm) delete payload.length_mm;
    if (!payload.material) delete payload.material;
    if (!payload.note) delete payload.note;
    return payload;
}

function buildContainerPayload(formData) {
    const typeId = toInt(formData.get('container_type_id'));
    const payload = {
        container_code: (formData.get('container_code') || '').trim(),
        container_type_id: typeId || null,
        note: (formData.get('note') || '').trim() || null,
        is_active: formData.get('is_active') ? 1 : 0,
    };
    if (!payload.container_type_id) delete payload.container_type_id;
    if (!payload.note) delete payload.note;
    return payload;
}

async function loadContainerTypes() {
    const tbody = document.getElementById('container-types-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="loading">Lade...</td></tr>';
    try {
        const items = await fetchContainerTypes();
        containerState.types = items;
        renderContainerTypes(items);
        populateContainerTypeSelect(items);
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" class="error">Fehler beim Laden.</td></tr>';
        console.error(err);
    }
}

function renderContainerTypes(items) {
    const tbody = document.getElementById('container-types-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!items.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Keine Typen erfasst.</td></tr>';
        return;
    }

    items.forEach((item) => {
        const tr = document.createElement('tr');
        const dims = [item.length_mm, item.width_mm, item.height_mm].filter(Boolean).join(' × ');
        tr.innerHTML = `
            <td>${item.shape}</td>
            <td>${item.volume_ml}</td>
            <td>${dims || '-'}</td>
            <td>${item.material || '-'}</td>
            <td>${item.note || ''}</td>
        `;
        tbody.appendChild(tr);
    });
}

function populateContainerTypeSelect(items) {
    const select = document.getElementById('container-type-select');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">-- optional --</option>';
    items.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = `${item.shape} · ${item.volume_ml} ml`;
        if (String(item.id) === current) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

async function loadContainers() {
    const tbody = document.getElementById('containers-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Lade...</td></tr>';
    try {
        const items = await fetchContainers(containerState.active);
        renderContainers(items);
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" class="error">Fehler beim Laden.</td></tr>';
        console.error(err);
    }
}

function renderContainers(items) {
    const tbody = document.getElementById('containers-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!items.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Keine Container angelegt.</td></tr>';
        return;
    }

    items.forEach((item) => {
        const tr = document.createElement('tr');
        const typeLabel = item.container_type_id ? `${item.shape || '-'} · ${item.volume_ml || '?'} ml` : '-';
        const status = item.is_active ? 'Aktiv' : 'Inaktiv';
        const buttonLabel = item.is_active ? 'Deaktivieren' : 'Reaktivieren';
        tr.innerHTML = `
            <td>${item.container_code}</td>
            <td>${typeLabel}</td>
            <td>${item.volume_ml || '-'}</td>
            <td>${item.material || '-'}</td>
            <td>${status}</td>
            <td>${item.note || ''}</td>
            <td><button data-action="toggle" data-id="${item.id}" data-active="${item.is_active ? 1 : 0}">${buttonLabel}</button></td>
        `;
        const btn = tr.querySelector('button[data-action="toggle"]');
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
                await updateContainer(item.id, { is_active: item.is_active ? 0 : 1 });
                await loadContainers();
            } catch (err) {
                alert('Status konnte nicht geändert werden.');
                console.error(err);
                btn.disabled = false;
            }
        });
        tbody.appendChild(tr);
    });
}

async function fetchContainerTypes() {
    const res = await fetch('/api/container-types');
    if (!res.ok) throw new Error('load_failed');
    const json = await res.json();
    return json.items || [];
}

async function fetchContainers(active) {
    const res = await fetch(`/api/containers?active=${encodeURIComponent(active)}`);
    if (!res.ok) throw new Error('load_failed');
    const json = await res.json();
    return json.items || [];
}

async function postJson(url, payload) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
        throw new Error(json.error || 'request_failed');
    }
    return json;
}

async function updateContainer(id, payload) {
    const res = await fetch(`/api/containers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
        throw new Error(json.error || 'request_failed');
    }
}

function toInt(value) {
    const num = parseInt(value, 10);
    return Number.isNaN(num) ? null : num;
}
