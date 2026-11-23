require("dotenv").config();

const { connectDatabase, disconnectDatabase } = require("../config/database");
const conditions = require("../data/conditions");
const Condition = require("../models/condition.model");
const { validateConditionCatalog } = require("../utils/catalog");

async function seedConditions() {
  validateConditionCatalog(conditions);
  await connectDatabase(process.env.MONGODB_URI);

  const operations = conditions.map((condition) => ({
    updateOne: {
      filter: { slug: condition.slug },
      update: { $set: condition },
      upsert: true,
    },
  }));

  const result = await Condition.bulkWrite(operations);
  console.log(
    `Condition catalog ready: ${result.upsertedCount} added, ${result.modifiedCount} updated.`,
  );
}

seedConditions()
  .catch((error) => {
    console.error(`Condition seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
