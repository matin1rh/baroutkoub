import sys
from PyQt6.QtWidgets import QApplication
from PyQt6.QtGui import QFont
from src.gui import MainWindow

def main():
    app = QApplication(sys.argv)
    font = QFont("Tahoma", 9)
    app.setFont(font)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()