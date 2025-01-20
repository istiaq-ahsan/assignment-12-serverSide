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
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://assignment-12-project-cf2cb.web.app",
  ],
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
    next();
  });
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
    const reviewCollection = db.collection("clientReview");

    const verifyAdmin = async (req, res, next) => {
      const email = req.user?.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user?.role !== "admin")
        return res
          .status(403)
          .send({ message: "Forbidden Access! Admin Only Actions!" });

      next();
    };

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
        status: "Normal",
        timestamp: Date.now(),
      });
      res.send(result);
    });

    //post and update biodata
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
      const decodedEmail = req.user?.email;
      if (decodedEmail !== email)
        return res.status(401).send({ message: "Unauthorized Access" });
      const query = { email };
      const result = await paymentCollection.find(query).toArray();

      const paymentStatus = await paymentCollection
        .aggregate([
          {
            $match: { email },
          },
          {
            $lookup: {
              from: "users",
              localField: "email",
              foreignField: "email",
              as: "userDetails",
            },
          },
          { $unwind: "$userDetails" },
          {
            $addFields: {
              userStatus: "$userDetails.status",
              userName: "$userDetails.name",
            },
          },
          {
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
      const { biodataType, division, occupation, miniAge, maxAge, search } =
        req.query;

      const filters = {};

      // Add filters if they exist
      if (biodataType) filters.biodataType = biodataType;
      if (division) filters.permanentDivision = division;
      if (occupation) filters.occupation = occupation;
      if (miniAge) filters.age = { ...filters.age, $gte: parseInt(miniAge) };
      if (maxAge) filters.age = { ...filters.age, $lte: parseInt(maxAge) };

      const query = {
        ...filters,
        ...(search && {
          name: {
            $regex: search,
            $options: "i",
          },
        }),
      };

      const biodatas = await biosCollection.find(query).toArray();

      res.send(biodatas);
    });

    //get premium biodata for homepage
    app.get("/premium-biodata", async (req, res) => {
      const { sort } = req.query;

      const query = { status: "Premium" };
      const sortOrder = sort === "asc" ? 1 : sort === "dsc" ? -1 : null;

      const result = await usersCollection
        .aggregate([
          {
            $match: query,
          },
          {
            $lookup: {
              from: "allBioData",
              localField: "email",
              foreignField: "email",
              as: "premiumBiodata",
            },
          },
          {
            $addFields: {
              biodataId: { $arrayElemAt: ["$premiumBiodata.bioDataId", 0] },
              biodataImage: { $arrayElemAt: ["$premiumBiodata.photoURL", 0] },
              biodataType: { $arrayElemAt: ["$premiumBiodata.biodataType", 0] },
              division: {
                $arrayElemAt: ["$premiumBiodata.permanentDivision", 0],
              },
              occupation: { $arrayElemAt: ["$premiumBiodata.occupation", 0] },
              biodataAge: { $arrayElemAt: ["$premiumBiodata.age", 0] },
              _idOfBiodata: { $arrayElemAt: ["$premiumBiodata._id", 0] },
            },
          },
          {
            $project: { premiumBiodata: 0 },
          },
          ...(sortOrder !== null
            ? [
                {
                  $sort: { biodataAge: sortOrder }, // Apply sorting based on the sortOrder
                },
              ]
            : []),
        ])
        .limit(6)
        .toArray();
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
    app.get("/all-user/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const query = { email: { $ne: email } };
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    //payment status requested from client
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

    //update role
    app.patch(
      "/user/role/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const { role } = req.body;
        const filter = { email };
        const updateDoc = {
          $set: { role },
        };
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    //update status
    app.patch(
      "/user/status/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const { status } = req.body;
        const filter = { email };
        const updateDoc = {
          $set: { status },
        };
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

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
    app.get("/admin-stat", verifyToken, verifyAdmin, async (req, res) => {
      const totalBioData = await biosCollection.estimatedDocumentCount();

      const totalPremium = await usersCollection.countDocuments({
        status: "Premium",
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

    //only requested user
    app.get("/req-user", verifyToken, verifyAdmin, async (req, res) => {
      const query = { status: "Requested" };
      const result = await usersCollection
        .aggregate([
          {
            $match: query,
          },
          {
            $lookup: {
              from: "allBioData",
              localField: "email",
              foreignField: "email",
              as: "biodataInfo",
            },
          },
          {
            $addFields: {
              biodataId: { $arrayElemAt: ["$biodataInfo.bioDataId", 0] },
            },
          },
          {
            $project: { biodataInfo: 0 },
          },
        ])
        .toArray();
      res.send(result);
    });

    //get the admin if exist
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.user.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    //public stat
    app.get("/public-stat", async (req, res) => {
      const totalBioData = await biosCollection.estimatedDocumentCount();

      const totalMaleBio = await biosCollection.countDocuments({
        biodataType: "Male",
      });
      const totalFemaleBio = await biosCollection.countDocuments({
        biodataType: "Female",
      });

      const couplePaired = await reviewCollection.estimatedDocumentCount();

      res.send({
        totalBioData,
        totalMaleBio,
        totalFemaleBio,
        couplePaired,
      });
    });

    //profile
    app.get("/profile/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

    //get review for homepage
    app.get("/client-review", async (req, res) => {
      const sort = req.query.sort;

      let options = {};
      if (sort) options = { sort: { marriageDate: sort === "asc" ? 1 : -1 } };

      const result = await reviewCollection.find().sort(options.sort).toArray();
      res.send(result);
    });

    //post review
    app.post("/success-story", verifyToken, async (req, res) => {
      const story = req.body;
      if (story.marriageDate) {
        story.marriageDate = new Date(story.marriageDate);
      }
      const result = await reviewCollection.insertOne(story);
      res.send(result);
    });

    //get review for admin
    app.get("/reviewFor-admin", verifyToken, verifyAdmin, async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
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
    // await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
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
