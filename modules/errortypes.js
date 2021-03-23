module.exports = {
    NotEnoughArgumentsError: class NotEnoughArgumentsError extends Error {
        constructor(message = "Not enough arguments.") {
            super(message);
            this.name = "NotEnoughArgumentsError";
        }
    },
    InvalidArgumentsError: class InvalidArgumentsError extends Error {
        constructor(message = "Invalid arguments.") {
            super(message);
            this.name = "InvalidArgumentsError";
        }
    },
    InstanceNotFoundError: class InstanceNotFoundError extends Error {
        constructor(message = "Could not find instance.") {
            super(message);
            this.name = "InstanceNotFoundError";
        }
    },
    DatabaseError: class DatabaseError extends Error {
        constructor(message = "Something went wrong working with the database.") {
            super(message);
            this.name = "DatabaseError";
        }
    }
};