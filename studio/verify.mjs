import assert from 'node:assert/strict';
import { frameAt, totalDuration } from '././timeline.js';
import { makeDemo } from '././data.js';

const shots = [{ duration: 4 }, { duration: 3 }, { duration: 5 }];
assert.equal(totalDuration(shots), 12);
assert.equal(frameAt(shots, 0), 0);
assert.equal(frameAt(shots, 3.9), 0);
assert.equal(frameAt(shots, 4), 1);
assert.equal(frameAt(shots, 7), 2);
assert.equal(frameAt(shots, 12), 2);
assert.equal(frameAt([], 0), 0);
const a = makeDemo();
const b = makeDemo();
a.scenes[0].text.ru = 'Авторская правка';
assert.notEqual(a.scenes[0].text.ru, b.scenes[0].text.ru);
assert.equal(a.scenes[0].text.kk, b.scenes[0].text.kk);
assert.ok(a.shots.every(shot => a.scenes.some(scene => scene.id === shot.sceneId)));
console.log('Timeline boundaries, independent project drafts and bilingual text: passed.');
