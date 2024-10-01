(function ($) {
    "use strict";
    jQuery(document).ready(function ($) {
        var owlCarousel = $(".hero__slider").owlCarousel({
            items: 1,
            nav: true,
            dot: false,
            loop: true,
            margin: 0,
            autoplay: false,
            autoplayTimeout: 6000,
            smartSpeed: 1000,
            responsiveClass: true,
            responsive: {
                0: {
                    items: 1,
                },
                768: {
                    items: 1,
                },
                1000: {
                    items: 1,
                }
            }
        });

        // Function to update the More button's href attribute and game title
        function updateDetails(event) {
            // Use the event.item.index to get the newly active item
            var currentIndex = event.item.index;
            var currentItem = $(".owl-item").eq(currentIndex).find(".single__item");

            // Now, currentItem should correctly refer to the new active item
            var url = currentItem.data('game-uuid');
            var title = currentItem.data('game-title');

            $('.more_btn').attr('href', '/games/' + url);
            $('.game_title').text(title);
        }

        // Update the details on carousel change
        owlCarousel.on('changed.owl.carousel', function (event) {
            updateDetails(event);
        });
    });
}(jQuery));
