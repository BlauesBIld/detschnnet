// JavaScript for Filtering Cards
const filterButtons = document.querySelectorAll('.filter-button');
const cards = document.querySelectorAll('.card');
let selectedFilters = new Set();

filterButtons.forEach(button => {
    button.addEventListener('click', () => {
        const filter = button.getAttribute('data-filter');

        if (selectedFilters.has(filter)) {
            selectedFilters.delete(filter);
            button.classList.remove('active');
        } else {
            selectedFilters.add(filter);
            button.classList.add('active');
        }

        updateCards();
    });
});

function updateCards() {
    cards.forEach(card => {
        const cardEngine = card.getAttribute('data-engine');
        if (selectedFilters.size === 0 || selectedFilters.has(cardEngine)) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });
}
