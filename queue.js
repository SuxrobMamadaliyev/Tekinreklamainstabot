// Oddiy ketma-ket bajariladigan navbat (queue).
// Instagram'ga bir vaqtda faqat 1 ta post yuklanishi kerak, aks holda
// koʻplab foydalanuvchi bir vaqtda yuborsa Instagram sessiyasi buziladi.
// Shu sabab barcha postlash amallari shu navbat orqali ketma-ket bajariladi.

class TaskQueue {
  constructor() {
    this.queue = [];
    this.running = false;
  }

  // Navbatda nechta vazifa kutayotganini qaytaradi
  size() {
    return this.queue.length;
  }

  // Vazifani navbatga qoʻshadi va u bajarilganda natijani qaytaradi
  push(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._run();
    });
  }

  async _run() {
    if (this.running) return;
    this.running = true;

    while (this.queue.length) {
      const { task, resolve, reject } = this.queue.shift();
      try {
        const result = await task();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    }

    this.running = false;
  }
}

module.exports = new TaskQueue();
