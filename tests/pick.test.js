// Run with: gjs -m tests/pick.test.js
import {pickPlayer} from '../sources/pick.js';

const fake = (status, title) => ({
    status,
    _playerProxy: {Metadata: title === undefined ? {} : {'xesam:title': {deepUnpack: () => title}}},
});
const check = (name, actual, expected) => {
    if (actual !== expected)
        throw new Error(`${name}: wrong player picked`);
};

const brave = fake('Playing', 'Set');
const paused = fake('Paused', 'Album');
const stopped = fake('Stopped');
const beep = fake('Playing');
const other = fake('Playing', 'Other');

// The bug: a silent app goes Playing then Stopped while the browser keeps playing
check('beep does not take over', pickPlayer([brave, beep], brave, beep), brave);
check('stopped current falls back to playing', pickPlayer([brave, stopped], stopped, stopped), brave);
check('beep does not beat paused music', pickPlayer([paused, beep], paused, beep), paused);
check('stopped current falls back to paused', pickPlayer([paused, stopped], stopped, stopped), paused);

check('started player takes over', pickPlayer([brave, other], brave, other), other);
check('paused change keeps current', pickPlayer([paused, fake('Paused', 'B')], paused, paused), paused);
check('pausing yields to playing', pickPlayer([paused, other], paused, paused), other);
check('titleless player alone still shows', pickPlayer([beep], null, beep), beep);
check('nothing to show', pickPlayer([stopped], stopped, stopped), null);
check('no players', pickPlayer([], null), null);
const pausedB = fake('Paused', 'B');
check('current stays on a tie', pickPlayer([paused, pausedB], pausedB), pausedB);
check('paused change does not take over', pickPlayer([paused, pausedB], paused, pausedB), paused);
check('empty title is not shown', pickPlayer([fake('Playing', ''), beep], null), beep);
check('closed player is skipped', pickPlayer([{_playerProxy: null}, paused], null), paused);
check('proxy not ready yet is skipped', pickPlayer([{_playerProxy: {}, status: undefined}, brave], null), brave);
print('ok');
