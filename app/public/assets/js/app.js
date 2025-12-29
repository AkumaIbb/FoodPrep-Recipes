const state = {
    view: 'meals',
    veggie: false,
    expiring: false,
    q: '',
};

document.addEventListener('DOMContentLoaded', () => {
    bindFilters();
    bindMenu();
    bindModal();
    loadData();
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
