const themesEl = document.getElementById("themes");
const difficultyEl = document.getElementById("difficulty");
const bestEl = document.getElementById("best");
const resetEl = document.getElementById("reset");
const soundEl = document.getElementById("sound");

const get = (keys) => new Promise((r) => chrome.storage.sync.get(keys, r));
const set = (obj) => new Promise((r) => chrome.storage.sync.set(obj, r));

async function load() {
  const s = await get(["theme", "best", "muted", "difficulty"]);
  const theme = s.theme || "glassy";
  for (const btn of themesEl.querySelectorAll(".theme")) {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  }
  const difficulty = s.difficulty || "normal";
  for (const btn of difficultyEl.querySelectorAll(".theme")) {
    btn.classList.toggle("active", btn.dataset.difficulty === difficulty);
  }
  soundEl.checked = !s.muted;
  bestEl.textContent = String(s.best || 0).padStart(4, "0");
}
load();

themesEl.addEventListener("click", async (e) => {
  const btn = e.target.closest(".theme");
  if (!btn || !btn.dataset.theme) return;
  await set({ theme: btn.dataset.theme });
  load();
});

difficultyEl.addEventListener("click", async (e) => {
  const btn = e.target.closest(".theme");
  if (!btn || !btn.dataset.difficulty) return;
  await set({ difficulty: btn.dataset.difficulty });
  load();
});
soundEl.addEventListener("change", () => set({ muted: !soundEl.checked }));
resetEl.addEventListener("click", async () => { await set({ best: 0 }); load(); });
