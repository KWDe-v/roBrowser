/**
 * tests/ui/Equipment.titles.test.js
 *
 * The Title tab lists the titles the player owns, not every title of titletable.lub. The server sends
 * no title list: a title is the reward of an achievement (reward.title in achievement_list.lub), and
 * rAthena accepts it once that reward was claimed.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: { Entity: null, Achievement: null }, sent: [] }));

const TITLES = { 1000: 'Jovem', 1001: 'Especialista', 1002: 'Mestre', 1003: 'Profissional' };

vi.mock('UI/CursorManager.js', () => ({ default: { ACTION: {}, getActualType: vi.fn(), setType: vi.fn() } }));
vi.mock('DB/DBManager.js', () => ({
	default: {
		INTERFACE_PATH: '',
		getItemInfo: () => ({}),
		getItemName: () => '',
		getMessage: id => (id === 2686 ? 'Remover Título' : ''),
		getAllTitles: () => TITLES,
		getTitleString: id => TITLES[id] || ''
	}
}));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn(), loadFiles: vi.fn() } }));
vi.mock('Core/Preferences.js', () => ({ default: { get: (_name, defaults) => ({ ...defaults, show: true, save: vi.fn() }) } }));
vi.mock('Renderer/Renderer.js', () => ({ default: { width: 1200, height: 800, render: vi.fn(), stop: vi.fn() } }));
vi.mock('Renderer/EntityManager.js', () => ({ default: { setOverEntity: vi.fn() } }));
vi.mock('Renderer/Camera.js', () => ({ default: {} }));
vi.mock('Renderer/SpriteRenderer.js', () => ({ default: { bind2DContext: vi.fn() } }));
vi.mock('Renderer/Entity/Entity.js', () => ({
	default: class {
		static TYPE_PC = 0;
		ACTION = { IDLE: 0 };
		effectColor = new Float32Array(4);
		set() {}
		renderEntity() {}
	}
}));
vi.mock('Engine/SessionStorage.js', () => ({ default: mocks.session }));
vi.mock('Network/NetworkManager.js', () => ({ default: { sendPacket: pkt => mocks.sent.push(pkt) } }));
vi.mock('UI/Scrollbar.js', () => ({ default: {} }));
vi.mock('UI/UIManager.js', () => ({ default: { addComponent: c => c } }));
vi.mock('UI/UIVersionManager.js', () => ({ default: { getEquipmentVersion: () => 0 } }));
vi.mock('UI/Elements/Elements.js', () => ({}));
vi.mock('UI/Components/ItemInfo/ItemInfo.js', () => ({ default: {} }));
vi.mock('UI/Components/CartItems/CartItems.js', () => ({ default: {} }));
vi.mock('UI/Components/SwitchEquip/SwitchEquip.js', () => ({ default: { append: vi.fn() } }));
vi.mock('UI/Components/WinStats/WinStats.js', () => ({ default: { getUI: () => ({ embed: vi.fn() }) } }));
vi.mock('UI/Components/Inventory/Inventory.js', () => ({ default: { getUI: () => ({}) } }));
vi.mock('Preferences/Graphics.js', () => ({ default: {} }));

HTMLCanvasElement.prototype.getContext = function () {
	return { canvas: this, clearRect() {} };
};

const Equipment = (await import('UI/Components/Equipment/EquipmentV3/EquipmentV3.js')).default;

// See Equipment.cartButton.test.js: prepare() leaves timers behind
const pendingTimers = new Set();
const realSetTimeout = globalThis.setTimeout;
vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms, ...args) => {
	const id = realSetTimeout(() => {
		pendingTimers.delete(id);
		fn(...args);
	}, ms);
	pendingTimers.add(id);
	return id;
});
afterAll(() => {
	pendingTimers.forEach(id => clearTimeout(id));
	vi.restoreAllMocks();
});

/** An achievement as onAllAchievementList stores it: packet fields plus the achievement_list.lub row. */
function achievement(id, { completed = 1, reward = 0, title = 0 } = {}) {
	return { ach_id: id, completed, reward, info: { reward: title ? { title } : {} } };
}

it('does not fail when achievements arrive before the window is built', () => {
	expect(Equipment.getRoot()).toBeFalsy();
	expect(() => Equipment.loadTitles()).not.toThrow();

	mocks.session.Entity = { hasCart: false, effectState: 0, ACTION: { IDLE: 0 }, effectColor: new Float32Array(4) };
	Equipment.append();
});

function listedTitles() {
	return [...Equipment.getRoot().querySelectorAll('#title_list .title-option')].map(el => el.textContent);
}

beforeEach(() => {
	mocks.sent.length = 0;
	mocks.session.Achievement = null;
	Equipment.setTitle(0);
});

describe('Equipment title tab', () => {
	it('lists no title without achievements, only "remove title"', () => {
		Equipment.loadTitles();
		expect(listedTitles()).toEqual(['Remover Título']);
	});

	it('lists the titles of achievements whose reward was claimed', () => {
		mocks.session.Achievement = {
			list: {
				1: achievement(1, { reward: 1, title: 1002 }),
				2: achievement(2, { reward: 1, title: 1000 }),
				3: achievement(3, { reward: 0, title: 1001 }), // completed, reward not claimed
				4: achievement(4, { completed: 0, reward: 0, title: 1003 }), // in progress
				5: achievement(5, { reward: 1 }) // reward without a title
			}
		};
		Equipment.loadTitles();
		expect(listedTitles()).toEqual(['Remover Título', 'Jovem', 'Mestre']);
	});

	it('keeps the title worn, even before the achievement list arrives', () => {
		Equipment.setTitle(1003);
		expect(listedTitles()).toEqual(['Remover Título', 'Profissional']);
		const selected = Equipment.getRoot().querySelector('#title_list .title-option.selected');
		expect(selected.textContent).toBe('Profissional');
	});

	it('sends one change request per click, however often the list was rebuilt', () => {
		mocks.session.Achievement = { list: { 1: achievement(1, { reward: 1, title: 1000 }) } };
		Equipment.loadTitles();
		Equipment.loadTitles();
		Equipment.loadTitles();

		const option = Equipment.getRoot().querySelector('#title_list .title-option[data-title="1000"]');
		option.click();
		expect(mocks.sent).toHaveLength(1);
		expect(mocks.sent[0].title_id).toBe(1000);
	});
});
