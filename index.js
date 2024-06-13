const express = require('express');
const { MongoClient, ServerApiVersion, Db, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_KEY)
const app = express();
const port = process.env.PORT || 5000;
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const mailgun = new Mailgun(formData);

const mg = mailgun.client({
    username: 'Shajim',
    key: process.env.MAIL_GUN_KEY ,
});



// middleware 
app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.q9eobgc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;




// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const menuCollection = client.db('BistroDB').collection('menu');
        const reviewCollection = client.db('BistroDB').collection('reviews');
        const CartCollection = client.db('BistroDB').collection('carts');
        const userCollection = client.db('BistroDB').collection('users');
        const paymentCollection = client.db('BistroDB').collection('payments');

        // custom middlewares
        const verifyToken = (req, res, next) => {
            // console.log('token:', req.headers);
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized Access' })
            }
            const token = req.headers.authorization.split(' ')[1];

            jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'unauthorized Access' })
                }
                req.decoded = decoded;
                // console.log(decoded);
                next()
            })
        }
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email
            const query = { email: email };
            const user = await userCollection.findOne(query)
            const isAdmin = user?.role === 'admin'
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden Access' })
            }
            next()
        }

        // jwt
        app.post('/jwt', async (req, res) => {
            const user = req.body
            const token = jwt.sign(user, process.env.ACCESS_TOKEN, {
                expiresIn: '1h'
            })
            res.send({ token })
        })



        // menu
        app.get('/menu', async (req, res) => {
            const result = await menuCollection.find().toArray()
            res.send(result)
        })
        app.get('/menu/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await menuCollection.findOne(query)
            res.send(result)
        })
        app.patch('/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
            const item = req.body;
            // console.log(item);
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            // const options = { upsert: true };
            const updatedItem = {
                $set: {
                    name: item.name,
                    category: item.category,
                    price: item.price,
                    recipe: item.recipe,
                    image: item.image
                }
            }
            const result = await menuCollection.updateOne(filter, updatedItem)
            res.send(result)
        })
        app.post('/menu', verifyToken, verifyAdmin, async (req, res) => {
            const menu = req.body;
            const result = await menuCollection.insertOne(menu)
            res.send(result)
        })
        app.delete('/menuItem/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await menuCollection.deleteOne(query)
            res.send(result)
        })

        // review
        app.get('/reviews', async (req, res) => {
            const result = await reviewCollection.find().toArray()
            res.send(result)
        })

        // carts
        app.get('/carts', async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const result = await CartCollection.find(query).toArray()
            res.send(result)
        })
        app.post('/carts', async (req, res) => {
            const food = req.body;
            const result = await CartCollection.insertOne(food)
            res.send(result)
        })
        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await CartCollection.deleteOne(query)
            res.send(result)
        })

        // user
        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            // console.log(req.headers);
            const result = await userCollection.find().toArray()
            res.send(result)
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const isExist = await userCollection.findOne(query)
            if (isExist) {
                return res.send({ message: 'user already exist', insertedId: null })
            }
            const result = await userCollection.insertOne(user)
            res.send(result)
        })

        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const updateUser = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await userCollection.updateOne(query, updateUser)
            res.send(result)
        })

        app.get('/user/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            // console.log(req.decoded);
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden Access' })
            }
            const query = { email: email };
            const user = await userCollection.findOne(query)
            let admin = false
            if (user) {
                admin = user?.role === 'admin'
            }
            res.send({ admin })
        })

        app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await userCollection.deleteOne(query)
            res.send(result)
        })



        // Payment

        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100)
            // console.log(amount);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'eur',
                "payment_method_types": [
                    "card",
                ],
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
            })
        })

        app.get('/payment/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            const query = {
                email: email
            }
            const result = await paymentCollection.find(query).toArray()
            res.send(result)
        })

        app.post('/payment', async (req, res) => {
            const stateMent = req.body;
            const PaymentRes = await paymentCollection.insertOne(stateMent)
            const query = {
                _id: {
                    $in: stateMent.cartsId.map(id => new ObjectId(id))
                }
            }
            const result = await CartCollection.deleteMany(query);

            // email configurations
            mg.messages.create(process.env.MAIL_DOMAIN, {
                from: "Mailgun Sandbox                                                             <sandbox60ca8b7ba8e64bddb9d3318272e10aba.mailgun.org>",
                to: ["ajshajimmax7878@gmail.com"],
                subject: "Bistro Boss Order Confirmed",
                text: "Thank you for your order!!!",
                html: `
                <div>
                <h1> Thank You for your Order!!! </h1>
                <h4> Your TransactionID :${stateMent.transactionID} </h4>
                <p> We would like to get your Feedback !!! </p>
                </div> `
            })
                .then(msg => console.log(msg)) // logs response data
                .catch(err => console.log(err)); // logs any error

            res.send({ PaymentRes, result })
        })


        //stats or analysis
        app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
            const users = await userCollection.estimatedDocumentCount()
            const menuItems = await menuCollection.estimatedDocumentCount()
            const orders = await paymentCollection.estimatedDocumentCount()
            const result = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalRevenue: {
                            $sum: '$price'
                        }
                    }
                }
            ]).toArray()
            const revenue = result.length > 0 ? result[0].totalRevenue : 0;


            res.send({ users, menuItems, orders, revenue })
        })

        app.get('/order-stats', verifyToken, verifyAdmin, async (req, res) => {

            const result = await paymentCollection.aggregate([
                {
                    $unwind: '$menuItemsId',
                },
                {
                    $addFields: {
                        menuItemsId: {
                            $toObjectId: '$menuItemsId'
                        }
                    }
                },
                {
                    $lookup: {
                        from: 'menu',
                        localField: 'menuItemsId',
                        foreignField: '_id',
                        as: 'menuItem',
                    },
                },
                {
                    $unwind: '$menuItem',
                },
                {
                    $group: {
                        _id: "$menuItem.category",
                        quantity: {
                            $sum: 1
                        },
                        revenue: { $sum: '$menuItem.price' }
                    }
                }, {
                    $project: {
                        _id: 0,
                        category: '$_id',
                        quantity: '$quantity',
                        revenue: '$revenue'

                    }
                }

            ]).toArray();
            res.send(result)
        })

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('boss is running')
})
app.listen(port, () => {
    console.log(`boss is running on ${port}`);
})




















