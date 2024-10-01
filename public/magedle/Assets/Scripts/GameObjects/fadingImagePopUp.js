class FadingImagePopUp extends ImageObject{
    text;
    currentTransparancy;
    timeStampCreated;
    delayToStartDissappearing = 700;
    textSize;
    directionToFadeY;

    constructor(imageFileName, x, y, size, directionToFadeY = -1) {
        super("fadingIcon", imageFileName, x, y, size, size);
        this.currentTransparancy = 1;
        this.timeStampCreated = Date.now();
        this.directionToFadeY = directionToFadeY;
    }

    draw() {
        gameManager.gameCanvas.drawLayer.save();
        gameManager.gameCanvas.drawLayer.beginPath();
        gameManager.gameCanvas.drawLayer.globalAlpha = this.currentTransparancy;
        gameManager.gameCanvas.drawLayer.drawImage(this.image, (this.spriteWidth + this.spriteSpacing) * this.currentColumnInSpriteSheet, (this.spriteHeight + this.spriteSpacing) * this.currentRowInSpriteSheet, this.dimensions.width * (this.image.width / this.dimensions.width) / (this.isSpriteSheet?(this.image.width / this.spriteWidth):1), this.dimensions.height * (this.image.height / this.dimensions.height)/(this.isSpriteSheet?(this.image.height / this.spriteHeight):1), this.position.x, this.position.y, this.dimensions.width, this.dimensions.height);
        gameManager.gameCanvas.drawLayer.closePath();
        gameManager.gameCanvas.drawLayer.restore();
    }

    update() {
        if(this.timeStampCreated + this.delayToStartDissappearing < Date.now()) {
            this.currentTransparancy -= 0.05;
            if (this.currentTransparancy <= 0) {
                this.destroy();
            }
        }
        this.position.y += 0.2 * this.directionToFadeY;
    }
}