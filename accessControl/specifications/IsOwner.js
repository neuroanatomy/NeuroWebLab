module.exports = class IsOwner {
  constructor(userId) {
    this.userId = userId;
  }

  isSatisfiedBy(project) {
    try {
      return this.userId === project.owner;
    } catch (e) {
      console.error(e.message);

      return false;
    }
  }
};
