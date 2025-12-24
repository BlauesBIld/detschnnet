// JavaScript for Filtering Cards (reflow-friendly)
const filterButtons = document.querySelectorAll('.filter-button');
const cardLinks = document.querySelectorAll('.card-container .card-link'); // hide/show these
const selectedFilters = new Set();

filterButtons.forEach(button => {
    button.addEventListener('click', () => {
        const filter = button.getAttribute('data-filter');

        if (selectedFilters.has(filter)) {
            selectedFilters.delete(filter);
            button.classList.remove('active');
            button.setAttribute('aria-pressed', 'false');
        } else {
            selectedFilters.add(filter);
            button.classList.add('active');
            button.setAttribute('aria-pressed', 'true');
        }

        updateCards();
    });
});

function updateCards() {
    cardLinks.forEach(link => {
        const card = link.querySelector('.card');
        const cardEngine = card?.getAttribute('data-engine');

        const shouldShow =
            selectedFilters.size === 0 || selectedFilters.has(cardEngine);

        if (shouldShow) {
            link.style.removeProperty('display'); // let CSS/grid decide display
            // Or: link.hidden = false;
        } else {
            link.style.display = 'none';
            // Or: link.hidden = true;
        }
    });
}

// Initial render
updateCards();

function toggleProfileImage(img) {
    const current = img.src;
    const alt = img.dataset.altSrc;

    img.src = alt;
    img.dataset.altSrc = current;
}

