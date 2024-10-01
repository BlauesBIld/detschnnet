let gameManager = new GameManager();
let waveManager = new WaveManager();
let playerManager = new PlayerManager();
let uiManager = new UIManager();

let gameCanvas = new Canvas("gameCanvas"),
    uiCanvas = new Canvas("uiCanvas");

gameManager.setWaveButton(document.getElementById("waveButton"));
uiManager.setInteractButton(document.getElementById("interactButton"));

gameManager.setGameCanvas(gameCanvas);
uiManager.setUiCanvas(uiCanvas);

let grasTileSize = 40;
setupRandomGrasTiles();

let magicBarrier = new MagicBarrier();
gameManager.setMagicBarrier(magicBarrier);
let castleObj = new Castle("castle", "Castle.png", 0, 0, gameCanvas.canvasBoundaries.right, gameCanvas.canvasBoundaries.bottom);
gameManager.setCastle(castleObj);

let playerHeight = 150,
    playerWidth = 100,
    playerSpawnPoint = {
        x: gameCanvas.canvasBoundaries.right / 2 - playerWidth / 2,
        y: gameCanvas.canvasBoundaries.bottom - playerHeight - 20
    }
player = new Player(playerSpawnPoint.x, playerSpawnPoint.y, playerWidth, playerHeight);

let gameCanvasLeft = gameCanvas.canvasHTMLElement.offsetLeft + gameCanvas.canvasHTMLElement.clientLeft,
    gameCanvasTop = gameCanvas.canvasHTMLElement.offsetTop + gameCanvas.canvasHTMLElement.clientTop;

gameCanvas.canvasHTMLElement.addEventListener("mousemove", function (event) {
    let x = event.pageX - gameCanvasLeft,
        y = event.pageY - gameCanvasTop;

    player.mousePosX = x;
    player.mousePosY = y;
});

let uiCanvasLeft = uiCanvas.canvasHTMLElement.offsetLeft + uiCanvas.canvasHTMLElement.clientLeft,
    uiCanvasTop = uiCanvas.canvasHTMLElement.offsetTop + uiCanvas.canvasHTMLElement.clientTop;

uiCanvas.canvasHTMLElement.addEventListener("mousemove", function (event) {
    let x = event.pageX - uiCanvasLeft,
        y = event.pageY - uiCanvasTop;

    uiManager.mousePosX = x;
    uiManager.mousePosY = y;
});

gameCanvas.canvasHTMLElement.addEventListener("mousedown", function (event) {
    if (event.button === 0) {
        player.isShooting = true;
    }
});

gameCanvas.canvasHTMLElement.addEventListener("mouseup", function (event) {
    if (event.button === 0) {
        player.isShooting = false;
    }
});

let titleObject = new FadingTitleText();
gameManager.setTitleObject(titleObject);

gameManager.dropItem(waveManager.getRandomItemNameWithTierFromItems(1), 650, 350);
uiManager.initializePage();

setUpBorderWalls();
requestAnimationFrame(gameManager.gameLoop);

function setupRandomGrasTiles() {
    for (let i = 0; i < 12; i++) {
        for (let j = 0; j < 12; j++) {
            let grasTileIndex = getRandomInt(7) + 1;
            new GrasTile("gras" + i, "Gras" + grasTileIndex + ".png", grasTileSize, gameCanvas.canvasBoundaries.right / 12 * i, gameCanvas.canvasBoundaries.bottom / 12 * j);
        }
    }
}

function setUpBorderWalls() {
    new GameObject("wall", 0, 0, gameCanvas.canvasBoundaries.right, 0);
    new GameObject("wall", 0, 0, 0, gameCanvas.canvasBoundaries.bottom);
    new GameObject("wall", 0, gameCanvas.canvasBoundaries.bottom, gameCanvas.canvasBoundaries.right, 0);
    new GameObject("wall", gameCanvas.canvasBoundaries.right, 0, 0, gameCanvas.canvasBoundaries.bottom);
}

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

function getRandomPositionOnXAxis(considerWidthOfObject = 0) {
    return getRandomInt(gameManager.gameCanvas.canvasBoundaries.right - considerWidthOfObject);
}

function capitalizeFirstLetterOfWord(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function getItemCategoryFromIndex(index) {
    switch (index) {
        case 0:
            return "weapon";
        case 1:
            return "hat";
        case 2:
            return "robe";
        case 3:
            return "accessory";
    }
}