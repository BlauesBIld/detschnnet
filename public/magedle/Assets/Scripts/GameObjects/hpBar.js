class HPBar extends ImageObject {
    border;
    fill;
    offsetY = 0;

    enemy;

    constructor(x, y, width, offsetY) {
        super("hpBarFill", "UI/HPBarFill.png", x, y + offsetY, width, 150 / (1024 / width));
        this.border = new ImageObject("hpBarBorder", "UI/HPBarBorder.png", x, y + offsetY, width, 150 / (1024 / width));
        this.offsetY = offsetY;
    }

    setEnemy(enemy) {
        this.enemy = enemy;
    }

    update() {
    }

}