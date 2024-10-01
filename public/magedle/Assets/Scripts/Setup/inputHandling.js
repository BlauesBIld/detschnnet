addEventListener("keydown", function (event) {
    switch (event.key) {

        case "w":
            player.velocity.yUp = 1;
            break;
        case "a":
            player.velocity.xLeft = 1;
            break;
        case "s":
            player.velocity.yDown = 1;
            break;
        case "d":
            player.velocity.xRight = 1;
            break;
    }

    if(!gameManager.musicIsPlaying){
        gameManager.playBackgroundMusic();
    }
})

addEventListener("keyup", function (event) {
    switch (event.key) {
        case "w":
            player.velocity.yUp = 0;
            break;
        case "a":
            player.velocity.xLeft = 0;
            break;
        case "s":
            player.velocity.yDown = 0;
            break;
        case "d":
            player.velocity.xRight = 0;
            break;
    }
})