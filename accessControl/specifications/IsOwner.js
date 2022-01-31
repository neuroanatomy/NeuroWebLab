module.exports = class IsOwner {
  constructor(userId) {
    this.userId = userId;
  }

  isSatisfiedBy(project) {
    return this.userId === project.owner;
  }
};
