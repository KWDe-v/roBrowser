/**
 * tests/engine/Achievement.rewardAck.test.js
 *
 * ZC_REQ_ACH_REWARD_ACK (0x0a26) carries 1 when the server gave the reward and 0 when it refused it
 * (rAthena clif_achievement_reward_ack). Only an accepted claim marks the achievement as claimed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ handlers: {}, session: { Achievement: null } }));

vi.mock('Network/NetworkManager.js', () => ({
	default: { hookPacket: (packet, fn) => (mocks.handlers[packet.name] = fn) }
}));
vi.mock('Engine/SessionStorage.js', () => ({ default: mocks.session }));
vi.mock('DB/DBManager.js', () => ({ default: { getAchievementTable: () => ({}), getMessage: () => '' } }));
vi.mock('UI/UIManager.js', () => ({ default: { components: {} } }));
vi.mock('UI/Components/Announce/Announce.js', () => ({ default: { append: vi.fn(), set: vi.fn() } }));
vi.mock('UI/Components/Equipment/Equipment.js', () => ({ default: { loadTitles: vi.fn() } }));
vi.mock('UI/Components/Achievement/Achievement.js', () => ({}));
vi.mock('DB/Effects/EffectConst.js', () => ({ default: {} }));
vi.mock('Renderer/EffectManager.js', () => ({ default: { spam: vi.fn() } }));

const { default: PACKET } = await import('Network/PacketStructure.js');
const { default: AchievementEngine } = await import('Engine/MapEngine/Achievement.js');
AchievementEngine();

const onRewardAck = mocks.handlers.PACKET_ZC_REQ_ACH_REWARD_ACK;

beforeEach(() => {
	mocks.session.Achievement = { list: { 7: { ach_id: 7, completed: 1, reward: 0 } } };
});

describe('ZC_REQ_ACH_REWARD_ACK', () => {
	it('reads the result byte, then the achievement id', () => {
		const bytes = [1, 7, 0, 0, 0];
		let pos = 0;
		const fp = {
			readUChar: () => bytes[pos++],
			readLong: () => {
				const value = bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24);
				pos += 4;
				return value;
			}
		};
		const pkt = new PACKET.ZC.REQ_ACH_REWARD_ACK(fp, 0);
		expect(pkt.result).toBe(1);
		expect(pkt.ach_id).toBe(7);
	});

	it('marks the reward claimed when the server gave it', () => {
		onRewardAck({ result: 1, ach_id: 7 });
		expect(mocks.session.Achievement.list[7].reward).toBe(1);
	});

	it('leaves it unclaimed when the server refused', () => {
		onRewardAck({ result: 0, ach_id: 7 });
		expect(mocks.session.Achievement.list[7].reward).toBe(0);
	});
});
