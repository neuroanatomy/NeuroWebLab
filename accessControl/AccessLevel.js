module.exports = class AccessLevel {
  static values = ['none', 'view', 'edit', 'add', 'remove'];

  static NONE = new AccessLevel('none');
  static VIEW = new AccessLevel('view');
  static EDIT = new AccessLevel('edit');
  static ADD = new AccessLevel('add');
  static REMOVE = new AccessLevel('remove');

  numericalLevel = 0;

  constructor(level) {
    const index = AccessLevel.values.indexOf(level);
    const maxValue = AccessLevel.values.length - 1;
    this.numericalLevel = Math.max(0, Math.min(index, maxValue));
  }

  static fromInt(level) {
    return new AccessLevel(this.values[level]);
  }

  toInt() {
    return this.numericalLevel;
  }

  toString() {
    return this.values[this.numericalLevel];
  }

  isGreaterThan(accessLevel) {
    return this.toInt() > accessLevel.toInt();
  }

  isGreaterThanOrEqualTo(accessLevel) {
    return this.toInt() >= accessLevel.toInt();
  }

  isLesserThan(accessLevel) {
    return this.toInt() < accessLevel.toInt();
  }

  isLesserThanOrEqualTo(accessLevel) {
    return this.toInt() <= accessLevel.toInt();
  }

  isEqualTo(accessLevel) {
    return this.toInt() === accessLevel.toInt();
  }

};
