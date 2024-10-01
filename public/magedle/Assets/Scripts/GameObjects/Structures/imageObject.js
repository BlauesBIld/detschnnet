class ImageObject extends GameObject {
    image;
    imageFilePath;

    currentColumnInSpriteSheet = 0;
    currentRowInSpriteSheet = 0;
    spriteWidth;
    spriteHeight;
    spriteSpacing;
    isSpriteSheet;

    constructor(name, fileName, x, y, width, height, spriteWidth = width, spriteHeight = height, spriteSpacing = 0, isSpriteSheet = false) {
        super(name, x, y, width, height);
        this.image = new Image();
        this.image.src = "./Sprites/" + fileName;
        this.spriteSpacing = spriteSpacing;
        this.spriteWidth = spriteWidth;
        this.spriteHeight = spriteHeight;
        this.isSpriteSheet = isSpriteSheet;
    }

    draw() {
        gameManager.gameCanvas.drawLayer.beginPath();
        gameManager.gameCanvas.drawLayer.drawImage(this.image, (this.spriteWidth + this.spriteSpacing) * this.currentColumnInSpriteSheet, (this.spriteHeight + this.spriteSpacing) * this.currentRowInSpriteSheet, this.dimensions.width * (this.image.width / this.dimensions.width) / (this.isSpriteSheet?(this.image.width / this.spriteWidth):1), this.dimensions.height * (this.image.height / this.dimensions.height)/(this.isSpriteSheet?(this.image.height / this.spriteHeight):1), this.position.x, this.position.y, this.dimensions.width, this.dimensions.height);
        gameManager.gameCanvas.drawLayer.closePath();
    }
}