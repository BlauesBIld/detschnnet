class Castle extends ImageObject {
    barrierLeft = new GameObject("wall", 0, gameManager.gameCanvas.canvasBoundaries.bottom / 2, 195, gameManager.gameCanvas.canvasBoundaries.right / 2);
    barrierRight = new GameObject("wall", gameManager.gameCanvas.canvasBoundaries.right - 195, gameManager.gameCanvas.canvasBoundaries.bottom / 2, 195, gameManager.gameCanvas.canvasBoundaries.bottom / 2);

    turretWidth = 195;
    safeZoneHeight = 255;

    safeZone = undefined;

    constructor(name, fileName, x, y, width, height) {
        super(name, fileName, x, y, width, height);
        this.safeZone = new Safezone("safeZone", "Safezone.png", this.turretWidth, gameManager.gameCanvas.canvasBoundaries.bottom - this.safeZoneHeight, gameManager.gameCanvas.canvasBoundaries.right-this.turretWidth*2, this.safeZoneHeight);
    }
}