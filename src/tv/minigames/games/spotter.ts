// Cloud Spotter on the TV: flat on your back in the garden at night, looking up past the treetops at a sky full
// of lettered clouds. Each phone secretly shows one of them.
import * as THREE from 'three';
import { LABELS, SPOTTER, makeField, roundPoints } from '../../../game/minigames/spotter';
import { pick } from '../../../game/rng';
import { cloudSvg } from '../../../shared/cloud';
import { lightRig } from '../../render/env';
import * as props from '../../render/props';
import { PALETTE as P, mix, seeded } from '../../render/toon';
import type { View } from '../../stage';
import { type Minigame, everyFrame } from '../types';

class NightSky implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 260);
  private readonly tick: (dt: number, time: number) => void;
  private readonly star: THREE.Mesh;
  private readonly starMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.6), transparent: true, opacity: 0, fog: false, depthWrite: false });
  private starAt = 3;
  private readonly lamp = new THREE.PointLight(P.lamp, 16, 22, 1.6);

  constructor() {
    const rig = lightRig(this.scene, 'moonlit', { fog: { near: 50, far: 170 }, shadowSize: 20 });
    rig.sun.castShadow = false; // only sky and treetops: no shadows to catch
    const rand = seeded(4);
    const set = new THREE.Group();

    // Clouds in two layers, drifting at different speeds.
    const far = props.cloudBank({ n: 13, area: [110, 24, 14], scale: 3.2, color: mix(P.moon, P.denim, 0.5), speed: 0.3, seed: 7 });
    far.position.set(0, 9, -48);
    const near = props.cloudBank({ n: 7, area: [80, 16, 8], scale: 1.9, color: mix(P.moon, P.mauve, 0.4), speed: 0.7, seed: 12 });
    near.position.set(0, 8, -26);
    set.add(far, near);

    // The garden's treetops frame the sky: a treeline along the bottom, taller trees in the corners.
    const kinds: props.TreeKind[] = ['round', 'pine', 'round', 'birch', 'round', 'pine'];
    for (let i = 0; i < 13; i++) {
      const t = props.tree({ kind: kinds[i % kinds.length] as props.TreeKind, h: 6 + rand() * 2.5, seed: i + 3 });
      t.position.set(-27 + i * 4.5 + (rand() - 0.5) * 2, -11.5 + rand() * 1.5, -11 - rand() * 4);
      set.add(t);
    }
    const corners: [number, number, number, number, props.TreeKind][] = [
      [-12.5, -8, -3.5, 10.5, 'round'],
      [-17, -8.5, -6.5, 14, 'pine'],
      [13, -8.5, -4, 11.5, 'round'],
      [17.5, -9, -7, 15, 'pine'],
      [-7.5, -9.5, -5, 8, 'birch'],
    ];
    corners.forEach(([x, y, z, h, kind], i) => {
      const t = props.tree({ kind, h, seed: 20 + i });
      t.position.set(x, y, z);
      set.add(t);
    });
    // String lights slung between the trees, and fireflies.
    const posts = [new THREE.Vector3(-13, -1.4, -4.2), new THREE.Vector3(-3, -2.9, -5.2), new THREE.Vector3(6, -3.0, -5.2), new THREE.Vector3(13.5, -1.2, -4.4)];
    for (let i = 0; i < posts.length - 1; i++) set.add(props.stringLights(posts[i] as THREE.Vector3, posts[i + 1] as THREE.Vector3, { sag: 0.5, count: 12, bulb: 0.07 }));
    const flies = props.motes({ n: 34, area: [30, 4.5, 6], color: '#d8ff9a', size: 0.12, seed: 9 });
    flies.position.set(0, -5.5, -6);
    set.add(flies);
    this.lamp.position.set(0, -2.2, -3.5);
    set.add(this.lamp);
    this.scene.add(set);
    this.tick = props.tickProps(set);

    // Now and then, a shooting star.
    this.star = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.035, 0.035), this.starMat);
    this.star.rotation.z = -0.32;
    this.scene.add(this.star);

    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 4.2, -20);
  }

  dispose(): void {
    this.star.geometry.dispose();
    this.starMat.dispose();
  }

  update(dt: number, time: number): void {
    this.tick(dt, time);
    this.lamp.intensity = 16 + Math.sin(time * 1.7) * 0.8;
    // The shooting star: a quick streak every eight seconds or so, somewhere new each time.
    const t = time - this.starAt;
    if (t > 8) this.starAt = time;
    const k = t / 0.7;
    if (k >= 0 && k <= 1) {
      const lane = Math.floor(this.starAt * 7.3) % 5;
      this.star.position.set(-22 + lane * 9 + k * 16, 22 - lane * 1.5 - k * 5.3, -60);
      this.starMat.opacity = Math.sin(k * Math.PI) * 0.9;
    } else {
      this.starMat.opacity = 0;
    }
  }
}

export const minigame: Minigame = {
  id: 'spotter',
  title: 'Cloud Spotting',
  how: 'You were watching one cloud drift by and now you have lost it. Your phone shows which one: find it on the big screen and tap its letter. Some of them look almost the same…',
  controller: 'secret',
  kind: 'ffa',

  async play(ctx) {
    const { seats, session, clock, ui, sfx, rng } = ctx;
    ctx.stage.setView(new NightSky());
    const points = seats.map(() => 0);
    const totalTime = seats.map(() => 0);
    const skill = seats.map(() => ctx.skill());
    const grid = document.createElement('div');
    grid.className = 'cloud-grid';
    // Keep the cards clear of the score list on the left.
    grid.style.padding = '2vh 2vw 2vh 19vw';
    grid.style.gap = '1.8vw 1.7vw';
    ui.overlay.replaceChildren(grid);

    for (let round = 0; round < SPOTTER.rounds; round++) {
      const field = makeField(rng, seats.length);
      const cards = field.clouds.map((cloud, i) => {
        const card = document.createElement('div');
        card.className = 'cloud-card';
        card.style.setProperty('--d', `${(i * 0.37) % 2}s`);
        card.innerHTML = cloudSvg(cloud, { size: 170, label: LABELS[i] }); // generated from numbers only
        return card;
      });
      grid.replaceChildren(...cards);
      const foundAt: (number | null)[] = seats.map(() => null);
      const lockedUntil = seats.map(() => 0);
      let now = 0;
      seats.forEach((s, i) => {
        session.setLayout(i, { kind: 'secret', cloud: field.clouds[field.targets[i] as number] as (typeof field.clouds)[number], labels: LABELS, round: round + 1, rounds: SPOTTER.rounds });
        void s;
      });

      const answer = (seat: number, index: number) => {
        if (foundAt[seat] !== null || now < (lockedUntil[seat] ?? 0)) return;
        if (index === field.targets[seat]) {
          foundAt[seat] = now;
          sfx.good();
          session.send(seat, { t: 'feedback', good: true, text: 'Found it!' });
          cards[index]?.style.setProperty('--ring', seats[seat]?.color ?? '#fff');
          cards[index]?.classList.add('found');
        } else {
          lockedUntil[seat] = now + SPOTTER.lockout;
          sfx.bad();
          session.send(seat, { t: 'feedback', good: false, text: 'Not that one! Wait a moment…' });
          session.send(seat, { t: 'buzz', pattern: [120] });
        }
      };
      const off = session.onInput((seat, msg) => {
        if (msg.t === 'answer' && !session.isCpu(seat)) answer(seat, msg.index);
      });
      // Computer couriers look for a while, and sometimes pick a look-alike first.
      const cpuPlan = seats.map((_, i) => {
        const s = skill[i] ?? 0.5;
        return { at: 2.5 + (1 - s) * 7 + rng() * 3, wrongFirst: rng() < 0.3 * (1.2 - s) };
      });

      ui.caption(`Round ${round + 1} of ${SPOTTER.rounds}: find your cloud!`);
      await everyFrame(clock, (_, t) => {
        now = t;
        seats.forEach((__, i) => {
          const plan = cpuPlan[i];
          if (!plan || !session.isCpu(i) || foundAt[i] !== null || t < plan.at) return;
          if (plan.wrongFirst) {
            plan.wrongFirst = false;
            const others = field.clouds.map((_c, k) => k).filter((k) => k !== field.targets[i]);
            answer(i, pick(rng, others));
            plan.at = t + SPOTTER.lockout + 1 + rng() * 2;
          } else {
            answer(i, field.targets[i] as number);
          }
        });
        ui.timer(SPOTTER.roundTime - t);
        return t >= SPOTTER.roundTime || foundAt.every((f) => f !== null);
      });
      off();
      // Reveal everyone's cloud.
      field.targets.forEach((target, seat) => {
        cards[target]?.style.setProperty('--ring', seats[seat]?.color ?? '#fff');
        cards[target]?.classList.add('found');
      });
      const pts = roundPoints(foundAt);
      pts.forEach((p, i) => {
        points[i] = (points[i] ?? 0) + p;
        totalTime[i] = (totalTime[i] ?? 0) + (foundAt[i] ?? SPOTTER.roundTime + 5);
      });
      ui.timer(null);
      ui.live(seats.map((s, i) => ({ name: s.name, color: s.color, thumb: s.thumb, value: `${points[i]} pts` })));
      session.setLayoutAll(() => ({ kind: 'wait', title: 'Next sky coming up…' }));
      await clock.wait(2.2);
    }
    ui.overlay.replaceChildren();
    ui.caption(null);
    return {
      scores: points.map((p, i) => p * 1000 - (totalTime[i] ?? 0)),
      details: points.map((p, i) => `${p} pts · ${(totalTime[i] ?? 0).toFixed(1)} s`),
    };
  },
};
