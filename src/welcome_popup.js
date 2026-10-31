function createPopup() {
  const overlayHTML = `<div id="popup-overlay"></div>`;
  const popupHTML = `
    <div id="welcome-popup" class="welcome-popup">
      <div class="popup-header">
        <img src="${chrome.runtime.getURL('icons8-easy-100-bg.png')}" alt="Icon">
        <h2 class="popup-title">Social Media Extension</h2>
      </div>
      <p class="popup-welcome">Welcome to Social Media Assistant!</p>
      <p>We're here to enhance your online conversations.</p>
      <ol>
        <li>Start by typing your initial thoughts.</li>
        <li>Use our AI to expand or refine your comment.</li>
        <li>Customize suggestions to match your style.</li>
      </ol>
      <p>Ready to make your voice heard</p>
      <div class="popup-actions">
        <label>
          <input type="checkbox" id="dont-show-again"> Don't show it again
        </label>
        <button id="got-it-btn">Got it</button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', overlayHTML + popupHTML);

  const overlay = document.getElementById('popup-overlay');
  const popup = document.getElementById('welcome-popup');
  const gotItBtn = document.getElementById('got-it-btn');
  const dontShowAgainCheckbox = document.getElementById('dont-show-again');

  gotItBtn.addEventListener('click', () => {
    popup.style.display = 'none';
    overlay.style.display = 'none';
    if (dontShowAgainCheckbox.checked) {
      chrome.storage.sync.set({ 'dontShowWelcomePopup': true });
    }
  });

  chrome.storage.sync.get('dontShowWelcomePopup', (result) => {
    if (!result.dontShowWelcomePopup) {
      overlay.style.display = 'block';
      popup.style.display = 'block';
    } else {
      overlay.style.display = 'none';
      popup.style.display = 'none';
    }
  });
}

createPopup();