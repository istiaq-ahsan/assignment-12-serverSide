const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const port = process.env.PORT || 5000;
const app = express();
require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);

const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};

app.use(express.json());
app.use(cors(corsOptions));
app.use(cookieParser());

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
  });
  next();
};

// verify admin after verifyToken
const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const query = { email: email };
  const user = await usersCollection.findOne(query);
  const isAdmin = user?.role === "admin";
  if (!isAdmin) {
    return res.status(403).send({ message: "forbidden access" });
  }
  next();
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.1pvay.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("heartMatch-db");
    const usersCollection = db.collection("users");
    const biosCollection = db.collection("allBioData");
    const favouriteCollection = db.collection("allFavData");
    const paymentCollection = db.collection("payments");

    app.post("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = req.body;
      const isExist = await usersCollection.findOne(query);
      if (isExist) {
        return res.send(isExist);
      }
      const result = await usersCollection.insertOne({
        ...user,
        role: "customer",
        member: "normal",
        timestamp: Date.now(),
      });
      res.send(result);
    });

    //post biodata
    app.patch("/all-bioData/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const decodedEmail = req.user.email;
      if (decodedEmail !== email)
        return res.status(401).send({ message: "Unauthorized Access" });
      const query = { email };
      const bioData = req.body;

      try {
        // Check if the resource exists
        const isExist = await biosCollection.findOne(query);

        if (isExist) {
          // Update the existing resource
          const updateResult = await biosCollection.updateOne(query, {
            $set: bioData,
          });
          return res.send({ message: "User BioData Updated", updateResult });
        } else {
          const lastEntry = await biosCollection
            .find()
            .sort({ bioDataId: -1 })
            .limit(1)
            .toArray();
          const newBioDataId =
            lastEntry.length > 0 ? lastEntry[0].bioDataId + 1 : 1;

          // Assign bioDataId to the new bioData
          bioData.bioDataId = newBioDataId;

          const insertResult = await biosCollection.insertOne(bioData);
          return res.send({ message: "User BioData Created", insertResult });
        }
      } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).send({ message: "An error occurred", error });
      }
    });

    //post favourite biodata
    app.post("/favouriteBio", verifyToken, async (req, res) => {
      const favBioData = req.body;
      const result = await favouriteCollection.insertOne(favBioData);
      res.send(result);
    });

    //payment
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log(amount);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    //save payment
    app.post("/payments", verifyToken, async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);

      res.send({ paymentResult });
    });

    //get payment status
    app.get("/contact-req/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const decodedEmail = req.user.email;
      if (decodedEmail !== email)
        return res.status(401).send({ message: "Unauthorized Access" });
      const query = { email };
      const result = await paymentCollection.find(query).toArray();

      const paymentStatus = await paymentCollection
        .aggregate([
          {
            $match: { email }, //Match specific customers data only by email
          },
          {
            $lookup: {
              // go to a different collection and look for data
              from: "users", // collection name
              localField: "email", // local data that you want to match
              foreignField: "email", // foreign field name of that same data
              as: "userDetails", // return the data as plants array (array naming)
            },
          },
          { $unwind: "$userDetails" }, // unwind lookup result, return without array
          {
            $addFields: {
              userStatus: "$userDetails.status",
              userName: "$userDetails.name",
            },
          },
          {
            // remove plants object property from order object
            $project: {
              userDetails: 0,
            },
          },
        ])
        .toArray();

      res.send(paymentStatus);
    });

    //get favourite biodata by specific user
    app.get("/favBioData/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const decodedEmail = req.user.email;
      if (decodedEmail !== email)
        return res.status(401).send({ message: "Unauthorized Access" });
      const query = { customerEmail: email };
      const result = await favouriteCollection.find(query).toArray();
      res.send(result);
    });

    //get specific biodata
    app.get("/bioData/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await biosCollection.findOne(query);
      res.send(result);
    });

    //get all biodata
    app.get("/all-biodata", async (req, res) => {
      const result = await biosCollection.find().toArray();
      res.send(result);
    });

    //get specific bioData by id
    app.get("/bioDataDetails/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await biosCollection.findOne(query);
      res.send(result);
    });

    //get specific user info
    app.get("/userInfo/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

    //get all user
    app.get("/all-user/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: { $ne: email } };
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    //manage status
    app.patch("/oneUser/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user?.status === "Requested")
        return res
          .status(400)
          .send("You have already requested, wait for some time.");

      const updateDoc = {
        $set: {
          status: "Requested",
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    //delete favourite biodata
    app.delete("/favOneBiodata/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await favouriteCollection.deleteOne(query);
      res.send(result);
    });

    //delete contact req
    app.delete("/contact-req-dlt/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await paymentCollection.deleteOne(query);
      res.send(result);
    });

    //admin stat dashboard
    app.get("/admin-stat", verifyToken, async (req, res) => {
      const totalBioData = await biosCollection.estimatedDocumentCount();

      const totalPremium = await usersCollection.countDocuments({
        member: "premium",
      });
      const totalMaleBio = await biosCollection.countDocuments({
        biodataType: "Male",
      });
      const totalFemaleBio = await biosCollection.countDocuments({
        biodataType: "Female",
      });

      const paymentDetails = await paymentCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: "$price" },
            },
          },
          {
            $project: {
              _id: 0,
            },
          },
        ])
        .next();

      res.send({
        totalBioData,
        totalPremium,
        totalMaleBio,
        totalFemaleBio,
        ...paymentDetails,
      });
    });

    // Generate jwt token
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.JWT_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.listen(port, () => {
  console.log(`Assignment 12 CRUD is running on port ${port}`);
});
